import React, { useCallback, useEffect, useRef, useState } from "react";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";
import { WS_URL } from "./services/ServoAPI";

// Map from joint names to servo IDs
// These need to match the actual joint names in the URDF model
const JOINT_TO_SERVO_MAP: Record<string, string> = {
  "1-servo_1-yaw": "base_yaw",
  "2-servo_2-pitch": "pitch",
  "3-servo_3-pitch": "pitch2",
  "4-servo_4-pitch": "pitch3",
  "5-servo_5-roll": "roll",
  "6-servo_6-grip": "grip",
};

// Map from servo IDs to joint names
const SERVO_TO_JOINT_MAP: Record<string, string> = Object.entries(
  JOINT_TO_SERVO_MAP
).reduce((map, [jointName, servoId]) => ({ ...map, [servoId]: jointName }), {});

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

    // Log joint names for debugging
    if (loadedRobot && loadedRobot.joints) {
      console.log("Available joints:", Object.keys(loadedRobot.joints));
      console.log("Servo to joint mapping:", SERVO_TO_JOINT_MAP);

      // Check if our joint mapping has the correct names
      Object.keys(JOINT_TO_SERVO_MAP).forEach((jointName) => {
        if (!loadedRobot.joints[jointName]) {
          console.warn(
            `Warning: Joint "${jointName}" from mapping not found in robot model`
          );
        }
      });
    }

    console.log("Robot loaded and stored in state");
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
          const data = JSON.parse(event.data);

          // Handle different message types
          if (data.type === "servo_positions" && !isDraggingRef.current) {
            // Process position update
            const positions = data.positions || {};

            // Only update if these are new positions and not our own update echo
            if (
              !data.broadcast ||
              lastUpdateTimeRef.current < Date.now() - 250
            ) {
              // Update our 3D model
              if (robotRef.current) {
                Object.entries(positions).forEach(([servoId, degrees]) => {
                  const jointName = SERVO_TO_JOINT_MAP[servoId];
                  if (jointName) {
                    // Update 3D model (convert degrees to radians)
                    robotRef.current.setJointValue(
                      jointName,
                      ((degrees as number) * Math.PI) / 180
                    );
                  }
                });
              }

              // Update our jointAngles state without causing refetching
              setJointAngles((prevAngles) => {
                const newAngles = { ...prevAngles };
                let hasChanges = false;

                // Update each angle that has changed
                Object.entries(positions).forEach(([servoId, degrees]) => {
                  const jointName = SERVO_TO_JOINT_MAP[servoId];
                  if (
                    jointName &&
                    (!prevAngles[jointName] ||
                      Math.abs(
                        prevAngles[jointName] -
                          ((degrees as number) * Math.PI) / 180
                      ) > 0.001)
                  ) {
                    newAngles[jointName] =
                      ((degrees as number) * Math.PI) / 180;
                    hasChanges = true;
                  }
                });

                // Only update state if values changed
                return hasChanges ? newAngles : prevAngles;
              });
            }
          } else if (data.type === "calibration_step") {
            const { joint, angle, current_step, total_steps } = data;
            console.log(
              `Received calibration step: Joint=${joint}, Angle=${angle}°, Step=${current_step}/${total_steps}`
            );

            setCurrentCalibrationStep({
              joint,
              angle,
              current_step,
              total_steps,
            });

            if (robotRef.current) {
              Object.keys(robotRef.current.joints).forEach((jointName) => {
                robotRef.current.setJointValue(
                  jointName,
                  jointName === SERVO_TO_JOINT_MAP[joint]
                    ? (angle * Math.PI) / 180
                    : 0
                );
              });
            }
          } else if (data.type === "position_captured") {
            // Notify user of successful position capture
            console.log(
              `Position captured for ${data.joint} at ${data.angle}°: ${data.position} - Waiting for next step...`
            );

            // Show visual feedback
            setCaptureSuccess(true);
            setTimeout(() => setCaptureSuccess(false), 1500);
          } else if (data.type === "calibration_complete") {
            console.log("Received calibration_complete message!", data);
            setIsCalibrating(false);
            setCurrentCalibrationStep(null);
            setCalibrationMode(false);

            // Sync positions if provided
            if (data.positions && robotRef.current) {
              console.log(
                "Updating robot positions with calibrated values:",
                data.positions
              );

              // Debug logging for conversion process
              console.log("Joint angle conversion details:");

              Object.entries(data.positions).forEach(([servoId, degrees]) => {
                const jointName = SERVO_TO_JOINT_MAP[servoId];
                if (jointName) {
                  // Ensure we're working with a number
                  const degreeValue =
                    typeof degrees === "number"
                      ? degrees
                      : parseFloat(String(degrees));
                  const radians = (degreeValue * Math.PI) / 180;

                  console.log(
                    `  ${servoId} (${jointName}): ${degreeValue}° → ${radians.toFixed(
                      4
                    )} rad`
                  );

                  robotRef.current.setJointValue(jointName, radians);
                }
              });

              // Also update our local joint angles state
              setJointAngles((prevAngles) => {
                const newAngles = { ...prevAngles };
                let hasChanges = false;

                Object.entries(data.positions).forEach(([servoId, degrees]) => {
                  const jointName = SERVO_TO_JOINT_MAP[servoId];
                  if (jointName) {
                    // Ensure we're working with a number
                    const degreeValue =
                      typeof degrees === "number"
                        ? degrees
                        : parseFloat(String(degrees));
                    const radians = (degreeValue * Math.PI) / 180;

                    newAngles[jointName] = radians;
                    hasChanges = true;
                  }
                });

                return hasChanges ? newAngles : prevAngles;
              });
            }

            // Notify user of completion
            console.log(
              "🎉 Calibration completed successfully! New positions applied."
            );
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
  }, [updateConnectionStatus]);

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
      if (updatingFromServer.current) return;

      if (robotRef.current && robotRef.current.setJointValue) {
        // Update 3D model
        robotRef.current.setJointValue(jointName, value);

        // Update our state to match
        setJointAngles((prev) => ({
          ...prev,
          [jointName]: value,
        }));

        // If we have a mapping for this joint, send to server
        const servoId = JOINT_TO_SERVO_MAP[jointName];
        if (servoId) {
          // Convert from radians to degrees for API
          const degrees = (value * 180) / Math.PI;

          // Send to server via WebSocket if connected
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "servo_update",
                servo_id: servoId,
                position: degrees,
              })
            );
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
        } else {
          console.warn(`No servo mapping found for joint: ${jointName}`);
        }
      }
    },
    [setupWebSocket, updateConnectionStatus]
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
      wsRef.current.send(
        JSON.stringify({
          type: "center_all",
        })
      );
      console.log("Sent center all command via WebSocket");

      // Update our UI to match (0 for all joints)
      if (robotRef.current) {
        const newAngles = { ...jointAngles };
        let hasChanges = false;

        Object.keys(JOINT_TO_SERVO_MAP).forEach((jointName) => {
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
  }, [jointAngles, setupWebSocket, updateConnectionStatus]);

  // Handle calibrate button click
  const handleCalibrateClick = useCallback(() => {
    // Send calibration command via WebSocket if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "start_calibration",
        })
      );
      console.log("Sent calibrate command via WebSocket");
      setCalibrationMode(true);
      setIsCalibrating(true);

      // The main message handler already processes calibration_step and calibration_complete messages
      // so we don't need to add a separate event listener here
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
  }, [setupWebSocket, updateConnectionStatus]);

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

      // Make sure we're using the same step number that the server sent us
      // Server expects step_number to be the current step being captured, not the next step
      const stepNumber = currentCalibrationStep.current_step;

      console.log(
        `Capturing position for step ${stepNumber}: ${currentCalibrationStep.joint} at ${currentCalibrationStep.angle}°`
      );

      // Create the message with step_number explicitly
      const message = JSON.stringify({
        type: "capture_position",
        joint: currentCalibrationStep.joint,
        angle: currentCalibrationStep.angle,
        step_number: stepNumber,
      });

      console.log("Sending capture position message:", message);
      wsRef.current.send(message);
    }
  }, [currentCalibrationStep]);

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
          <div className="bg-white/90 rounded-lg p-3 mb-2">
            <h3 className="text-sm font-bold mb-2 text-gray-900">
              Calibration In Progress
            </h3>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
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
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-orange-500 h-1.5 rounded-full"
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

            <div className="bg-gray-100 rounded p-2 mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-medium">Current Joint:</span>
                <span className="text-xs">{currentCalibrationStep.joint}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs font-medium">Target Angle:</span>
                <span className="text-xs">{currentCalibrationStep.angle}°</span>
              </div>
            </div>

            <div className="text-xs text-gray-700 mb-3">
              <p>1. Manually position the joint to the target angle</p>
              <p>2. Click "Capture Position" when ready</p>
            </div>

            <button
              onClick={handleCapturePosition}
              className={`w-full ${
                captureSuccess
                  ? "bg-green-700 hover:bg-green-800"
                  : "bg-green-500 hover:bg-green-600"
              } text-white py-2 rounded font-medium text-sm transition-colors relative`}
              disabled={captureSuccess}
            >
              {captureSuccess ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="w-4 h-4 mr-1"
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
                "Capture Position"
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
