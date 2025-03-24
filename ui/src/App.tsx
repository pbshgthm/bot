import React, { useCallback, useEffect, useRef, useState } from "react";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";
import {
  WS_URL,
  captureCalibrationPosition,
  centerAllServos,
  endCalibration,
  setCalibrationStep,
  startCalibration,
  updateServoPosition,
} from "./services/ServoAPI";

// Direct mapping from URDF joint names to servo IDs (only needed for API communication)
const JOINT_TO_SERVO_ID: Record<string, number> = {
  "1-servo_1-yaw": 1,
  "2-servo_2-pitch": 2,
  "3-servo_3-pitch": 3,
  "4-servo_4-pitch": 4,
  "5-servo_5-roll": 5,
  "6-servo_6-grip": 6,
};

// Display names for joints (optional, for UI display only)
const JOINT_DISPLAY_NAMES: Record<string, string> = {
  "1-servo_1-yaw": "Base Yaw",
  "2-servo_2-pitch": "Pitch",
  "3-servo_3-pitch": "Pitch 2",
  "4-servo_4-pitch": "Pitch 3",
  "5-servo_5-roll": "Roll",
  "6-servo_6-grip": "Grip",
};

// Helper function to find a joint name by servo ID (for consistent lookup)
const getJointNameById = (servoId: number): string | undefined => {
  return Object.entries(JOINT_TO_SERVO_ID).find(
    ([_, id]) => id === servoId
  )?.[0];
};

// Helper function to get a display name for a joint (for UI)
const getJointDisplayName = (servoId: number): string => {
  const jointName = getJointNameById(servoId);
  return jointName
    ? JOINT_DISPLAY_NAMES[jointName] || jointName
    : `Servo ${servoId}`;
};

function App() {
  const [robot, setRobot] = useState<any>(null);
  const robotRef = useRef<any>(null);
  // State for joint angles - decoupled from 3D model to improve slider responsiveness
  const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
  // Track server connection status
  const [serverStatus, setServerStatus] = useState<
    "connected" | "disconnected" | "connecting"
  >("connecting");
  // Track if user is dragging a slider
  const isDraggingRef = useRef(false);
  // Prevent infinite loops when updating positions
  const updatingFromServer = useRef(false);
  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  // Track WebSocket reconnection attempts
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Throttle UI updates from WebSocket
  const lastUpdateTimeRef = useRef(0);
  const throttleTimeMs = 250; // Update UI at most every 250ms
  // Track connection status internally to avoid multiple state updates
  const connectedRef = useRef(false);
  // Track if we're in a mounting cycle to prevent duplicate connections
  const isMountingRef = useRef(false);
  // Last time we tried to connect to prevent rapid reconnection attempts
  const lastConnectionAttemptRef = useRef(0);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [currentCalibrationStep, setCurrentCalibrationStep] = useState<{
    joint: string;
    angle: number;
    current_step?: number;
    total_steps?: number;
  } | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  // Add calibration state variables
  const [allServoIds, setAllServoIds] = useState<number[]>([]);
  const calibrationAngles = [0, 90, -90]; // Zero, max, min

  // Initialize joint angles from URDF model
  useEffect(() => {
    if (robot && robot.joints) {
      const initialAngles: Record<string, number> = {};
      Object.entries(robot.joints).forEach(
        ([jointName, joint]: [string, any]) => {
          initialAngles[jointName] = joint.angle || 0;
        }
      );
      setJointAngles(initialAngles);
    }
  }, [robot]);

  const handleRobotLoaded = useCallback((loadedRobot: any) => {
    // Store reference
    robotRef.current = loadedRobot;
    setRobot(loadedRobot);

    // Check if the joint mapping has the correct names
    if (loadedRobot && loadedRobot.joints) {
      Object.keys(JOINT_TO_SERVO_ID).forEach((jointName) => {
        if (!loadedRobot.joints[jointName]) {
          console.warn(
            `Warning: Joint "${jointName}" from mapping not found in robot model`
          );
        }
      });
    }
  }, []);

  // Update the UI status without causing too many re-renders
  const updateConnectionStatus = useCallback(
    (status: "connected" | "disconnected" | "connecting") => {
      // Only update state if there's an actual change
      if (status === "connected" && !connectedRef.current) {
        connectedRef.current = true;
        setServerStatus("connected");
      } else if (status !== "connected" && connectedRef.current) {
        connectedRef.current = false;
        setServerStatus(status);
      } else if (status !== serverStatus && !connectedRef.current) {
        setServerStatus(status);
      }
    },
    []
  ); // Remove serverStatus dependency to break cycle

  // Set up WebSocket connection
  const setupWebSocket = useCallback(() => {
    // Prevent rapid reconnection attempts
    const now = Date.now();
    if (now - lastConnectionAttemptRef.current < 1000) {
      console.log("Throttling connection attempts");
      return;
    }
    lastConnectionAttemptRef.current = now;

    // Don't try to reconnect if we're unmounting or already have a connection
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    // If we're currently in a React double-mount cycle, don't create a new connection yet
    if (isMountingRef.current) {
      console.log("Skipping WebSocket setup during mounting phase");
      return;
    }

    // Close existing connection if any
    if (wsRef.current) {
      // Don't send "component unmounting" for normal reconnects
      if (wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    updateConnectionStatus("connecting");

    // Create new connection
    try {
      console.log("Creating new WebSocket connection to", WS_URL);
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("WebSocket connection established");
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
        updateConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          console.log(`WebSocket message received: ${event.data}`);
          const data = JSON.parse(event.data);
          const lastUpdateTime = lastUpdateTimeRef.current;
          const currentTime = Date.now();

          // Handle initial position updates, respect throttling
          if (
            data.type === "servo_positions" &&
            data.positions &&
            !updatingFromServer.current &&
            currentTime - lastUpdateTime >= throttleTimeMs
          ) {
            // Update throttle timestamp
            lastUpdateTimeRef.current = currentTime;

            if (robotRef.current) {
              console.log("Received servo positions:", data.positions);
              updatingFromServer.current = true;

              // Update each joint in the 3D model based on servo ID
              Object.entries(data.positions).forEach(
                ([servoIdStr, degrees]) => {
                  const servoId = Number(servoIdStr);
                  const jointName = getJointNameById(servoId);

                  if (jointName && robotRef.current?.joints[jointName]) {
                    // Ensure we're working with a number
                    const degreeValue =
                      typeof degrees === "number"
                        ? degrees
                        : parseFloat(String(degrees));
                    const radians = (degreeValue * Math.PI) / 180;

                    // Update the 3D model joint
                    robotRef.current.setJointValue(jointName, radians);
                  }
                }
              );

              // Also update our local joint angles state
              setJointAngles((prevAngles) => {
                const newAngles = { ...prevAngles };
                let hasChanges = false;

                Object.entries(data.positions).forEach(
                  ([servoIdStr, degrees]) => {
                    const servoId = Number(servoIdStr);
                    const jointName = getJointNameById(servoId);

                    if (jointName && robotRef.current?.joints[jointName]) {
                      // Ensure we're working with a number
                      const degreeValue =
                        typeof degrees === "number"
                          ? degrees
                          : parseFloat(String(degrees));
                      const radians = (degreeValue * Math.PI) / 180;

                      newAngles[jointName] = radians;
                      hasChanges = true;
                    }
                  }
                );

                // Only update state if we have changes to avoid spurious rerenders
                return hasChanges ? newAngles : prevAngles;
              });

              // Reset updating flag after a short delay
              setTimeout(() => {
                updatingFromServer.current = false;
              }, 50);
            }
          } else if (data.type === "calibration_started") {
            console.log("Calibration started message received:", data);
            setCalibrationMode(true);
            setIsCalibrating(true);

            // Initialize list of servo IDs if not already set
            if (allServoIds.length === 0) {
              // We need to extract all available servo IDs
              const servoIds = Object.values(JOINT_TO_SERVO_ID);
              console.log("Setting up calibration with servo IDs:", servoIds);
              setAllServoIds(servoIds as number[]);

              // Start with the first step
              if (servoIds.length > 0) {
                const firstServoId = servoIds[0];
                const firstAngle = calibrationAngles[0];
                const totalSteps = servoIds.length * calibrationAngles.length;

                console.log(`Initializing first calibration step:`);
                console.log(
                  `- Joint: ${getJointDisplayName(
                    firstServoId
                  )} (ID: ${firstServoId})`
                );
                console.log(`- Angle: ${firstAngle}°`);
                console.log(`- Total steps: ${totalSteps}`);

                // Set up the first calibration step
                setCurrentCalibrationStep({
                  joint: String(firstServoId),
                  angle: firstAngle,
                  current_step: 1,
                  total_steps: totalSteps,
                });

                // Send the first step to the server
                setCalibrationStep(firstServoId, firstAngle, 1, totalSteps)
                  .then(() => {
                    console.log(
                      "First calibration step sent successfully to server"
                    );
                  })
                  .catch((error) =>
                    console.error(
                      "Failed to set first calibration step:",
                      error
                    )
                  );
              } else {
                console.error("No servo IDs found for calibration!");
              }
            } else {
              console.log("Servo IDs already set:", allServoIds);
            }

            // Reset all joints to zero in the 3D model at start of calibration
            if (robotRef.current) {
              console.log("Resetting all joints to zero for calibration start");
              Object.keys(robotRef.current.joints).forEach((jointName) => {
                robotRef.current.setJointValue(jointName, 0);
              });

              setJointAngles((prev) => {
                const newAngles = { ...prev };
                Object.keys(robotRef.current.joints).forEach((jointName) => {
                  newAngles[jointName] = 0;
                });
                return newAngles;
              });
            }
          } else if (data.type === "calibration_step_ack") {
            // Server acknowledged our calibration step
            console.log("Calibration step acknowledged:", data);
          } else if (data.type === "position_captured") {
            // Position captured, proceed to next step
            console.log("Position captured:", data);
            const { joint, angle } = data;
            const servoId = Number(joint);
            const displayName = getJointDisplayName(servoId);

            console.log(
              `Position captured for ${displayName} at ${angle}°: ${data.position}`
            );

            // Show visual feedback
            setCaptureSuccess(true);
            setTimeout(() => setCaptureSuccess(false), 1500);

            // DIRECT IMPLEMENTATION: Use the servo IDs from JOINT_TO_SERVO_ID and fixed angles
            const allServos = Object.values(JOINT_TO_SERVO_ID) as number[];
            const allAngles = [0, 90, -90]; // Zero, max, min
            console.log("Direct implementation using:", {
              allServos,
              allAngles,
            });

            // Find the current position in the sequence
            const currentServoId = Number(joint);
            const currentAngle = angle;
            let currentServoIndex = allServos.findIndex(
              (id) => id === currentServoId
            );
            let currentAngleIndex = allAngles.findIndex(
              (a) => a === currentAngle
            );

            console.log("Current position:", {
              currentServoId,
              currentAngle,
              currentServoIndex,
              currentAngleIndex,
            });

            if (currentServoIndex >= 0 && currentAngleIndex >= 0) {
              // Calculate next position
              let nextAngleIndex = (currentAngleIndex + 1) % allAngles.length;
              let nextServoIndex = currentServoIndex;

              // If we've gone through all angles for this joint, move to the next joint
              if (nextAngleIndex === 0) {
                nextServoIndex = (currentServoIndex + 1) % allServos.length;
              }

              // Check if we've completed the full cycle
              if (
                nextServoIndex === 0 &&
                nextAngleIndex === 0 &&
                (currentServoIndex > 0 || currentAngleIndex > 0)
              ) {
                // We've completed the full cycle
                console.log("Calibration complete, sending end_calibration");
                endCalibration()
                  .then(() => {
                    setIsCalibrating(false);
                    setCurrentCalibrationStep(null);
                    setCalibrationMode(false);
                  })
                  .catch((error) =>
                    console.error("Failed to end calibration:", error)
                  );
              } else {
                // Move to the next step
                const nextServoId = allServos[nextServoIndex];
                const nextAngle = allAngles[nextAngleIndex];
                const totalSteps = allServos.length * allAngles.length;
                const nextStep =
                  nextServoIndex * allAngles.length + nextAngleIndex + 1;

                console.log(
                  `NEXT STEP: Servo ${nextServoId} at ${nextAngle}° (Step ${nextStep}/${totalSteps})`
                );

                // Update UI state
                setCurrentCalibrationStep({
                  joint: String(nextServoId),
                  angle: nextAngle,
                  current_step: nextStep,
                  total_steps: totalSteps,
                });

                // Send to server
                setCalibrationStep(nextServoId, nextAngle, nextStep, totalSteps)
                  .then(() => {
                    console.log(
                      `Successfully set next calibration step: Servo ${nextServoId} at ${nextAngle}°`
                    );
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to set next calibration step:",
                      error
                    );
                    alert(
                      "Failed to move to next calibration step. Check console for details."
                    );
                  });
              }
            } else {
              console.error("Invalid current position:", {
                currentServoId,
                currentAngle,
                currentServoIndex,
                currentAngleIndex,
              });
            }
          } else if (data.type === "calibration_completed") {
            console.log("Calibration completed:", data);
            setIsCalibrating(false);
            setCurrentCalibrationStep(null);
            setCalibrationMode(false);
          } else if (data.type === "error") {
            console.error("Received error from server:", data.message);
            // Could show an error message to the user here
          }
        } catch (error: unknown) {
          console.error("Error processing WebSocket message:", error);
        }
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket connection closed (code: ${event.code}, reason: ${event.reason})`
        );
        updateConnectionStatus("disconnected");

        // Don't automatically reconnect for clean closes or during mounting phase
        const isCleanClose = event.code === 1000 || event.code === 1001;

        // Attempt to reconnect (with exponential backoff)
        if (
          !isCleanClose &&
          !isMountingRef.current &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          const delay = Math.min(
            1000 * Math.pow(1.5, reconnectAttemptsRef.current),
            10000
          );
          console.log(`Attempting to reconnect in ${delay / 1000} seconds...`);

          if (reconnectTimeoutRef.current) {
            window.clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectAttemptsRef.current++;
            setupWebSocket();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        updateConnectionStatus("disconnected");
        // No need to handle reconnection here - will be handled in onclose
      };

      // Store the WebSocket connection
      wsRef.current = ws;
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      updateConnectionStatus("disconnected");
    }
  }, [updateConnectionStatus, calibrationAngles]);

  // Initialize WebSocket connection with protection against React's double-mount behavior
  useEffect(() => {
    // Mark that we're in the mounting phase
    isMountingRef.current = true;

    // No need to fetch initial positions via HTTP API - will be received via WebSocket

    // Delay initial connection to avoid issues with React StrictMode double mounting
    const initialConnectionTimeout = setTimeout(() => {
      isMountingRef.current = false;
      setupWebSocket();
    }, 300);

    // Clean up WebSocket on component unmount
    return () => {
      clearTimeout(initialConnectionTimeout);

      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }

      // Close the connection with a clean close
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }

      // Mark that we're not in mounting phase anymore
      isMountingRef.current = false;
    };
  }, []); // Remove setupWebSocket dependency

  // Handle joint changes from UI controls
  const handleJointChange = useCallback(
    (jointName: string, value: number) => {
      // Don't send updates back to server if we're currently updating from server data
      if (updatingFromServer.current) {
        console.log(
          `Skipping update for ${jointName} as we're updating from server`
        );
        return;
      }

      console.log(`Joint change: ${jointName} -> ${value} radians`);

      if (robotRef.current && robotRef.current.setJointValue) {
        // Update 3D model
        robotRef.current.setJointValue(jointName, value);

        // Update our state to match
        setJointAngles((prev) => ({
          ...prev,
          [jointName]: value,
        }));

        // If we have a mapping for this joint, send to server
        const servoId = JOINT_TO_SERVO_ID[jointName];
        if (servoId) {
          // Convert from radians to degrees for API
          const degrees = (value * 180) / Math.PI;

          console.log(
            `Sending command: Servo ID ${servoId} -> ${degrees}° (from joint ${jointName})`
          );

          // Send to server via WebSocket if connected
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log(
              `WebSocket is open, sending command via updateServoPosition`
            );
            updateServoPosition(servoId, degrees)
              .then((response) => {
                console.log(`Command sent successfully:`, response);
              })
              .catch((error) => {
                console.error("Failed to update servo position:", error);
                updateConnectionStatus("disconnected");
              });
          } else {
            console.warn(
              `WebSocket not open (state: ${wsRef.current?.readyState}), cannot send command`
            );
            updateConnectionStatus("disconnected");

            // Only try to reconnect if not already trying and not in mounting phase
            if (
              !isMountingRef.current &&
              wsRef.current?.readyState !== WebSocket.CONNECTING
            ) {
              setupWebSocket();
            }
          }
        } else {
          console.warn(`No servo mapping found for joint: ${jointName}`);
          // Log all available mappings to help debug
          console.log("Available mappings:", JOINT_TO_SERVO_ID);
        }
      }
    },
    [updateConnectionStatus]
  );

  // Handle drag start/end to prevent WebSocket updates during slider interaction
  const handleDragStart = useCallback(() => {
    console.log("Drag started, disabling position sync from server");
    isDraggingRef.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    console.log("Drag ended, enabling position sync from server");
    isDraggingRef.current = false;
  }, []);

  // Handle center all button click
  const handleCenterAll = useCallback(() => {
    // Send center command via WebSocket if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      centerAllServos()
        .then(() => {
          console.log("Centered all servos");

          // Update our UI to match (0 for all joints)
          if (robotRef.current) {
            const newAngles = { ...jointAngles };
            let hasChanges = false;

            Object.keys(JOINT_TO_SERVO_ID).forEach((jointName) => {
              if (robotRef.current.joints[jointName]) {
                robotRef.current.setJointValue(jointName, 0);
                if (jointAngles[jointName] !== 0) {
                  newAngles[jointName] = 0;
                  hasChanges = true;
                }
              }
            });

            // Only update state if values changed
            if (hasChanges) {
              setJointAngles(newAngles);
            }
          }
        })
        .catch((error) => {
          console.error("Failed to center servos:", error);
          updateConnectionStatus("disconnected");
        });
    } else {
      updateConnectionStatus("disconnected");

      // Only try to reconnect if not already trying and not in mounting phase
      if (
        !isMountingRef.current &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        setupWebSocket();
      }
    }
  }, [jointAngles, updateConnectionStatus]);

  // Handle calibrate button click
  const handleCalibrateClick = useCallback(() => {
    console.log(
      "Calibrate button clicked, WebSocket state:",
      wsRef.current?.readyState
    );

    // Only proceed if WebSocket is open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("WebSocket is open, sending startCalibration request");

      // Initialize calibration state immediately for better user feedback
      setCalibrationMode(true);
      setIsCalibrating(true);

      // If we have servo IDs from joint mapping, pre-initialize calibration
      const servoIds = Object.values(JOINT_TO_SERVO_ID);
      console.log("JOINT_TO_SERVO_ID mapping:", JOINT_TO_SERVO_ID);
      console.log("Pre-initializing calibration with servo IDs:", servoIds);

      // Force set allServoIds immediately to a new array
      const servoIdsArray = servoIds as number[];
      setAllServoIds(servoIdsArray);

      // Store a local reference for immediate use
      window.setTimeout(() => {
        console.log("Checking if allServoIds was set correctly:", allServoIds);
      }, 0);

      // Start with the first step
      const firstServoId = servoIds[0];
      const firstAngle = calibrationAngles[0];
      const totalSteps = servoIds.length * calibrationAngles.length;

      console.log(`Setting up first calibration step:`);
      console.log(
        `- Joint: ${getJointDisplayName(firstServoId)} (ID: ${firstServoId})`
      );
      console.log(`- Angle: ${firstAngle}°`);
      console.log(`- Total steps: ${totalSteps}`);

      // Set up the first calibration step in UI immediately
      setCurrentCalibrationStep({
        joint: String(firstServoId),
        angle: firstAngle,
        current_step: 1,
        total_steps: totalSteps,
      });

      // Reset all joints to zero in the 3D model
      if (robotRef.current) {
        console.log("Resetting all joints to zero for calibration start");
        Object.keys(robotRef.current.joints).forEach((jointName) => {
          robotRef.current.setJointValue(jointName, 0);
        });

        // Update the active joint
        const jointName = getJointNameById(firstServoId);
        if (jointName) {
          console.log(`Setting active joint ${jointName} to ${firstAngle}°`);
          const radians = (firstAngle * Math.PI) / 180;
          robotRef.current.setJointValue(jointName, radians);

          // Update jointAngles state
          setJointAngles((prev) => {
            const newAngles = { ...prev };
            Object.keys(robotRef.current.joints).forEach((robotJointName) => {
              if (jointName && robotJointName === jointName) {
                newAngles[robotJointName] = (firstAngle * Math.PI) / 180;
              } else {
                newAngles[robotJointName] = 0;
              }
            });
            return newAngles;
          });
        }
      }

      // Send the calibration request to the server
      startCalibration()
        .then(() => {
          console.log("startCalibration request was successful");

          // Don't wait for server response to start first calibration step
          if (servoIds.length > 0) {
            const firstServoId = servoIds[0];
            const firstAngle = calibrationAngles[0];
            const totalSteps = servoIds.length * calibrationAngles.length;

            // Send the first step to the server
            console.log("Sending first calibration step to server");
            setCalibrationStep(firstServoId, firstAngle, 1, totalSteps)
              .then(() => {
                console.log(
                  "First calibration step sent successfully to server"
                );
              })
              .catch((error) => {
                console.error("Failed to set first calibration step:", error);
                alert(
                  "Failed to set calibration step. Check console for details."
                );
              });
          }
        })
        .catch((error) => {
          console.error("Failed to start calibration:", error);
          alert("Failed to start calibration. Check console for details.");
          updateConnectionStatus("disconnected");

          // Reset calibration state on error
          setCalibrationMode(false);
          setIsCalibrating(false);
          setCurrentCalibrationStep(null);
        });
    } else {
      console.error("WebSocket not open, can't start calibration");
      alert("WebSocket connection is not open. Please check your connection.");
      updateConnectionStatus("disconnected");

      // Only try to reconnect if not already trying and not in mounting phase
      if (
        !isMountingRef.current &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        setupWebSocket();
      }
    }
  }, [updateConnectionStatus]);

  // Handle capture position button click
  const handleCapturePosition = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      currentCalibrationStep
    ) {
      // Log the current calibration step to debug
      console.log(
        "Current calibration step:",
        JSON.stringify(currentCalibrationStep)
      );

      const { joint, angle, current_step } = currentCalibrationStep;
      const stepNumber = current_step || 1;

      // The joint in this case is already the servo ID as a string
      const servoId = Number(joint);
      const displayName = getJointDisplayName(servoId);

      console.log(
        `Capturing position for step ${stepNumber}: ${displayName} (servo ID ${servoId}) at ${angle}°`
      );

      // Show success immediately for better user experience
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 1500);

      // Send the capture request
      captureCalibrationPosition(servoId.toString(), angle, stepNumber)
        .then((result) => {
          console.log(`Position captured successfully: ${result.position}`);

          // DIRECT IMPLEMENTATION: Move to next step immediately
          const allServos = Object.values(JOINT_TO_SERVO_ID) as number[];
          const allAngles = [0, 90, -90]; // Zero, max, min

          // Find current position in sequence
          const currentServoIndex = allServos.findIndex((id) => id === servoId);
          const currentAngleIndex = allAngles.findIndex((a) => a === angle);

          console.log("Current position in sequence:", {
            currentServoIndex,
            currentAngleIndex,
            allServos,
            allAngles,
          });

          if (currentServoIndex >= 0 && currentAngleIndex >= 0) {
            // Calculate next position
            let nextAngleIndex = (currentAngleIndex + 1) % allAngles.length;
            let nextServoIndex = currentServoIndex;

            // If we've gone through all angles for this joint, move to the next joint
            if (nextAngleIndex === 0) {
              nextServoIndex = (currentServoIndex + 1) % allServos.length;
            }

            console.log("Next position calculated:", {
              nextServoIndex,
              nextAngleIndex,
            });

            // Check if we've completed the full cycle
            if (
              nextServoIndex === 0 &&
              nextAngleIndex === 0 &&
              (currentServoIndex > 0 || currentAngleIndex > 0)
            ) {
              // We've completed the full cycle
              console.log("Calibration complete, sending end_calibration");
              endCalibration()
                .then(() => {
                  setIsCalibrating(false);
                  setCurrentCalibrationStep(null);
                  setCalibrationMode(false);
                })
                .catch((error) =>
                  console.error("Failed to end calibration:", error)
                );
            } else {
              // Move to the next step
              const nextServoId = allServos[nextServoIndex];
              const nextAngle = allAngles[nextAngleIndex];
              const totalSteps = allServos.length * allAngles.length;
              const nextStep =
                nextServoIndex * allAngles.length + nextAngleIndex + 1;

              console.log(
                `NEXT STEP (client): Servo ${nextServoId} at ${nextAngle}° (Step ${nextStep}/${totalSteps})`
              );

              // Update UI state
              setCurrentCalibrationStep({
                joint: String(nextServoId),
                angle: nextAngle,
                current_step: nextStep,
                total_steps: totalSteps,
              });

              // Send to server
              setCalibrationStep(nextServoId, nextAngle, nextStep, totalSteps)
                .then(() => {
                  console.log(
                    `Successfully set next calibration step: Servo ${nextServoId} at ${nextAngle}°`
                  );
                })
                .catch((error) => {
                  console.error("Failed to set next calibration step:", error);
                  alert(
                    "Failed to move to next calibration step. Check console for details."
                  );
                });
            }
          } else {
            console.error("Invalid current position:", {
              servoId,
              angle,
              currentServoIndex,
              currentAngleIndex,
            });
          }
        })
        .catch((error) => {
          console.error("Failed to capture position:", error);
          setCaptureSuccess(false);
          alert("Failed to capture position. Check console for details.");
        });
    }
  }, [currentCalibrationStep, getJointDisplayName]);

  // Manually reconnect WebSocket if we've been disconnected for too long
  useEffect(() => {
    let reconnectInterval: number | null = null;

    if (serverStatus === "disconnected" && !isMountingRef.current) {
      // Schedule periodic reconnection attempts if disconnected
      reconnectInterval = window.setInterval(() => {
        if (serverStatus === "disconnected" && !isMountingRef.current) {
          console.log("Attempting scheduled reconnection...");
          setupWebSocket();
        }
      }, 5000); // Try every 5 seconds
    }

    return () => {
      if (reconnectInterval !== null) {
        window.clearInterval(reconnectInterval);
      }
    };
  }, [serverStatus, setupWebSocket]);

  // Add a more detailed log at the start of the effect
  useEffect(() => {
    // Update 3D model when calibration step changes
    if (isCalibrating && currentCalibrationStep && robotRef.current) {
      const { joint, angle } = currentCalibrationStep;
      const servoId = Number(joint);
      const jointName = getJointNameById(servoId);

      console.log(
        `CALIBRATION MODEL UPDATE: Updating 3D model for calibration step:`
      );
      console.log(`- Joint: ${jointName} (servo ID ${servoId})`);
      console.log(`- Target Angle: ${angle}°`);
      console.log(
        `- Step: ${currentCalibrationStep.current_step}/${currentCalibrationStep.total_steps}`
      );

      if (!jointName) {
        console.error(`Could not find joint name for servo ID ${servoId}!`);
        console.log(`Available mappings:`, JOINT_TO_SERVO_ID);
        return;
      }

      // Reset all joints to zero
      Object.keys(robotRef.current.joints).forEach((robotJointName) => {
        // Set all joints to zero except the active calibration joint
        if (jointName && robotJointName === jointName) {
          // Set the active joint to the calibration angle
          const radians = (angle * Math.PI) / 180;
          console.log(
            `Setting active joint ${robotJointName} to ${angle}° (${radians.toFixed(
              4
            )} radians)`
          );
          robotRef.current.setJointValue(robotJointName, radians);
        } else {
          console.log(`Setting inactive joint ${robotJointName} to 0`);
          robotRef.current.setJointValue(robotJointName, 0);
        }
      });

      // Update jointAngles state to match
      setJointAngles((prev) => {
        const newAngles = { ...prev };
        Object.keys(robotRef.current.joints).forEach((robotJointName) => {
          if (jointName && robotJointName === jointName) {
            newAngles[robotJointName] = (angle * Math.PI) / 180;
          } else {
            newAngles[robotJointName] = 0;
          }
        });
        console.log("Updated jointAngles state for calibration:", newAngles);
        return newAngles;
      });
    }
  }, [currentCalibrationStep, isCalibrating]);

  return (
    <div className="w-full h-screen m-0 p-0 overflow-hidden relative">
      {/* 3D Viewer Container */}
      <div className="threejs-container">
        <URDFViewer onRobotLoaded={handleRobotLoaded} />
      </div>

      {/* Controls Container - fixed position */}
      <div className="fixed top-4 right-4 w-80 max-h-[calc(100vh-2rem)] z-50 shadow-xl pointer-events-auto">
        {/* Server status indicator & center button */}
        <div className="bg-white/90 rounded-lg p-2 mb-2 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                serverStatus === "connected"
                  ? "bg-green-500"
                  : serverStatus === "connecting"
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
            ></div>
            <span className="text-xs text-gray-700">
              {serverStatus === "connected"
                ? "Connected to server"
                : serverStatus === "connecting"
                ? "Connecting..."
                : "Disconnected"}
            </span>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={handleCenterAll}
              className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs transition-colors"
              disabled={calibrationMode}
            >
              Center All
            </button>
            <button
              onClick={handleCalibrateClick}
              className="bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded text-xs transition-colors"
              disabled={calibrationMode}
            >
              Calibrate
            </button>
          </div>
        </div>

        {/* Calibration UI */}
        {isCalibrating && currentCalibrationStep && (
          <div className="bg-white/95 backdrop-blur-md rounded-lg p-4 mb-2 border-2 border-orange-500">
            <h3 className="text-lg font-bold mb-3 text-orange-600">
              Calibration Mode
            </h3>
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>
                  Step {currentCalibrationStep.current_step} of{" "}
                  {currentCalibrationStep.total_steps}
                </span>
                <span>
                  {Math.round(
                    ((currentCalibrationStep.current_step || 0) /
                      (currentCalibrationStep.total_steps || 1)) *
                      100
                  )}
                  %
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-orange-500 h-2 rounded-full"
                  style={{
                    width: `${Math.round(
                      ((currentCalibrationStep.current_step || 0) /
                        (currentCalibrationStep.total_steps || 1)) *
                        100
                    )}%`,
                  }}
                ></div>
              </div>
            </div>

            <div className="bg-orange-50 rounded-lg p-4 mb-4 border border-orange-200">
              <h4 className="text-base font-bold mb-2 text-gray-800">
                Current Task:
              </h4>

              <div className="flex items-center justify-center mb-3">
                <div className="bg-orange-100 rounded-full px-4 py-2 font-bold text-orange-800">
                  {getJointDisplayName(Number(currentCalibrationStep.joint))}
                </div>
                <div className="mx-2 text-gray-400">→</div>
                <div className="bg-blue-100 rounded-full px-4 py-2 font-bold text-blue-800">
                  {currentCalibrationStep.angle}°
                </div>
              </div>

              <div className="text-sm text-gray-700 bg-white p-3 rounded border border-gray-200">
                <ol className="list-decimal pl-5 space-y-2">
                  <li>
                    Manually position the{" "}
                    <strong className="text-orange-600">
                      {getJointDisplayName(
                        Number(currentCalibrationStep.joint)
                      )}
                    </strong>{" "}
                    joint to{" "}
                    <strong className="text-blue-600">
                      {currentCalibrationStep.angle}°
                    </strong>
                  </li>
                  <li>Check the 3D model to see the correct position</li>
                  <li>
                    Click "Capture Position" when the joint is properly
                    positioned
                  </li>
                </ol>
              </div>
            </div>

            <button
              onClick={handleCapturePosition}
              className={`w-full ${
                captureSuccess
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-green-500 hover:bg-green-600"
              } text-white py-3 rounded-lg font-medium text-base transition-colors relative`}
              disabled={captureSuccess}
            >
              {captureSuccess ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    ></path>
                  </svg>
                  Position Captured!
                </span>
              ) : (
                <span className="flex items-center justify-center">
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Capture Position
                </span>
              )}
            </button>
          </div>
        )}

        {/* Robot controls */}
        {robot ? (
          <RobotControls
            robot={robot}
            onJointChange={handleJointChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            jointValues={jointAngles}
            isCalibrating={isCalibrating}
          />
        ) : (
          <div className="bg-white/90 rounded-lg p-4 text-gray-800 font-medium">
            Loading robot controls...
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
