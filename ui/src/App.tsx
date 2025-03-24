import React, { useCallback, useEffect, useRef, useState } from "react";
import CalibrationUI from "./components/CalibrationUI";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";
import {
  WS_URL,
  centerAllServos,
  getTorqueEnabled,
  setCalibrationStep,
  setTorqueEnabled,
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

// Helper function to find a joint name by servo ID (for consistent lookup)
const getJointNameById = (servoId: number): string | undefined => {
  return Object.entries(JOINT_TO_SERVO_ID).find(
    ([_, id]) => id === servoId
  )?.[0];
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
  // Torque enabled state
  const [torqueEnabled, setTorqueEnabledState] = useState(true);

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
  );

  // Set up WebSocket connection
  const setupWebSocket = useCallback(() => {
    // Prevent rapid reconnection attempts
    const now = Date.now();
    if (now - lastConnectionAttemptRef.current < 1000) {
      return;
    }
    lastConnectionAttemptRef.current = now;

    // Don't try to reconnect if we're unmounting or already have a connection
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    // If we're currently in a React double-mount cycle, don't create a new connection yet
    if (isMountingRef.current) {
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
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
        updateConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const lastUpdateTime = lastUpdateTimeRef.current;
          const currentTime = Date.now();

          // Handle initial position updates, respect throttling
          if (
            data.type === "servo_positions" &&
            data.positions &&
            !isDraggingRef.current &&
            !updatingFromServer.current &&
            currentTime - lastUpdateTime >= throttleTimeMs
          ) {
            // Update throttle timestamp
            lastUpdateTimeRef.current = currentTime;

            if (robotRef.current) {
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
            setCalibrationMode(true);
            setIsCalibrating(true);

            // Start with the first step
            const servoIds = Object.values(JOINT_TO_SERVO_ID) as number[];
            if (servoIds.length > 0) {
              const firstServoId = servoIds[0];
              const angles = [0, 90, -90]; // Zero, max, min
              const firstAngle = angles[0];
              const totalSteps = servoIds.length * angles.length;

              // Set up the first calibration step
              setCurrentCalibrationStep({
                joint: String(firstServoId),
                angle: firstAngle,
                current_step: 1,
                total_steps: totalSteps,
              });

              // Send the first step to the server
              setCalibrationStep(firstServoId, firstAngle, 1, totalSteps);
            }
          } else if (data.type === "calibration_completed") {
            setIsCalibrating(false);
            setCurrentCalibrationStep(null);
            setCalibrationMode(false);
          } else if (data.type === "calibration_canceled") {
            // Handle calibration cancellation response with current positions
            setIsCalibrating(false);
            setCurrentCalibrationStep(null);
            setCalibrationMode(false);

            console.log(
              "Received calibration_canceled with positions:",
              data.positions
            );

            // Update robot model with current positions
            if (robotRef.current && data.positions) {
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

                    // Also update our local state
                    setJointAngles((prev) => ({
                      ...prev,
                      [jointName]: radians,
                    }));
                  }
                }
              );

              // Reset updating flag after a short delay
              setTimeout(() => {
                updatingFromServer.current = false;
              }, 50);
            }
          }
        } catch (error: unknown) {
          console.error("Error processing WebSocket message:", error);
        }
      };

      ws.onclose = (event) => {
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

          if (reconnectTimeoutRef.current) {
            window.clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectAttemptsRef.current++;
            setupWebSocket();
          }, delay);
        }
      };

      ws.onerror = () => {
        updateConnectionStatus("disconnected");
        // No need to handle reconnection here - will be handled in onclose
      };

      // Store the WebSocket connection
      wsRef.current = ws;
    } catch (error) {
      updateConnectionStatus("disconnected");
    }
  }, [updateConnectionStatus]);

  // Initialize WebSocket connection with protection against React's double-mount behavior
  useEffect(() => {
    // Mark that we're in the mounting phase
    isMountingRef.current = true;

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
  }, []);

  // Fetch torque status when connected
  useEffect(() => {
    if (serverStatus === "connected" && !isMountingRef.current) {
      // Get initial torque state
      getTorqueEnabled()
        .then((enabled) => {
          setTorqueEnabledState(enabled);
        })
        .catch(() => {
          console.error("Failed to get torque status");
        });
    }
  }, [serverStatus]);

  // Handle torque toggle
  const handleTorqueToggle = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const newTorqueState = !torqueEnabled;

      // Show a loading indicator or disable UI interaction here if needed

      setTorqueEnabled(newTorqueState)
        .then(() => {
          setTorqueEnabledState(newTorqueState);
          console.log(
            `Torque ${newTorqueState ? "enabled" : "disabled"} successfully`
          );
        })
        .catch((error) => {
          console.error(`Failed to toggle torque: ${error.message}`);

          // Revert the toggle in UI if the server request failed
          // This ensures the UI stays in sync with the actual server state
          alert(
            `Failed to toggle torque: ${error.message}. The robot's state may be out of sync.`
          );

          // Only update connection status if it's a connection error, not a timeout
          if (error.message.includes("timeout")) {
            console.warn(
              "Torque command timed out - server might be busy or processing another command"
            );
          } else {
            updateConnectionStatus("disconnected");
          }
        });
    } else {
      updateConnectionStatus("disconnected");
      alert("Cannot toggle torque - server connection lost");

      // Only try to reconnect if not already trying and not in mounting phase
      if (
        !isMountingRef.current &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        setupWebSocket();
      }
    }
  }, [torqueEnabled, updateConnectionStatus, setupWebSocket]);

  // Handle joint changes from UI controls
  const handleJointChange = useCallback(
    (jointName: string, value: number) => {
      // Don't send updates back to server if we're currently updating from server data
      if (updatingFromServer.current) {
        return;
      }

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

          // Send to server via WebSocket if connected
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            updateServoPosition(servoId, degrees).catch(() => {
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
        }
      }
    },
    [updateConnectionStatus]
  );

  // Handle drag start/end to prevent WebSocket updates during slider interaction
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // Add a delay after drag ends before accepting server updates
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = true; // Keep blocking updates

    // Add a short delay before accepting server updates again
    // This gives time for our command to be processed by the server
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 1000); // 1 second delay to let our changes stabilize
  }, []);

  // Handle center all button click
  const handleCenterAll = useCallback(() => {
    // Send center command via WebSocket if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      centerAllServos()
        .then(() => {
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
        .catch(() => {
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
    // Only proceed if WebSocket is open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Initialize calibration state immediately for better user feedback
      setCalibrationMode(true);
      setIsCalibrating(true);

      // Start with the first step
      const servoIds = Object.values(JOINT_TO_SERVO_ID);
      const angles = [0, 90, -90]; // Zero, max, min

      if (servoIds.length > 0) {
        const firstServoId = servoIds[0];
        const firstAngle = angles[0];
        const totalSteps = servoIds.length * angles.length;

        // Set up the first calibration step in UI immediately
        setCurrentCalibrationStep({
          joint: String(firstServoId),
          angle: firstAngle,
          current_step: 1,
          total_steps: totalSteps,
        });

        // Send the calibration request to the server
        startCalibration()
          .then(() => {
            // Send the first step to the server
            setCalibrationStep(firstServoId, firstAngle, 1, totalSteps);
          })
          .catch(() => {
            // Reset calibration state on error
            setCalibrationMode(false);
            setIsCalibrating(false);
            setCurrentCalibrationStep(null);

            updateConnectionStatus("disconnected");
            alert("Failed to start calibration.");
          });
      }
    } else {
      updateConnectionStatus("disconnected");
      alert("WebSocket connection is not open.");

      // Only try to reconnect if not already trying and not in mounting phase
      if (
        !isMountingRef.current &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        setupWebSocket();
      }
    }
  }, [updateConnectionStatus]);

  // Handle cancel calibration
  const handleCancelCalibration = useCallback(() => {
    // Reset calibration state
    setIsCalibrating(false);
    setCurrentCalibrationStep(null);
    setCalibrationMode(false);

    // Send cancel command to server if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Use existing WebSocket to send a cancel message with proper requestId
      const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      wsRef.current.send(
        JSON.stringify({
          type: "cancel_calibration",
          requestId: requestId,
        })
      );

      console.log("Sent cancel_calibration request to server");
    }
  }, []);

  const handleCalibrationComplete = useCallback(() => {
    setIsCalibrating(false);
    setCurrentCalibrationStep(null);
    setCalibrationMode(false);
  }, []);

  // Manually reconnect WebSocket if we've been disconnected for too long
  useEffect(() => {
    let reconnectInterval: number | null = null;

    if (serverStatus === "disconnected" && !isMountingRef.current) {
      // Schedule periodic reconnection attempts if disconnected
      reconnectInterval = window.setInterval(() => {
        if (serverStatus === "disconnected" && !isMountingRef.current) {
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
            {!calibrationMode && (
              <>
                <div className="flex items-center">
                  <label className="relative inline-flex items-center cursor-pointer mr-2">
                    <input
                      type="checkbox"
                      checked={torqueEnabled}
                      onChange={handleTorqueToggle}
                      className="sr-only peer"
                    />
                    <div
                      className={`w-9 h-5 rounded-full peer peer-focus:ring-2 peer-focus:ring-offset-1 
                      ${
                        torqueEnabled
                          ? "bg-green-500 peer-focus:ring-green-400"
                          : "bg-red-500 peer-focus:ring-red-400"
                      } 
                      after:content-[''] after:absolute after:top-0.5 after:left-[2px] 
                      after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 
                      after:transition-all ${
                        torqueEnabled ? "after:translate-x-full" : ""
                      }`}
                    ></div>
                  </label>
                  <span className="text-xs font-medium text-gray-700">
                    Torque: {torqueEnabled ? "ON" : "OFF"}
                  </span>
                </div>
                <button
                  onClick={handleCenterAll}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs transition-colors"
                >
                  Center All
                </button>
              </>
            )}
            {!calibrationMode ? (
              <button
                onClick={handleCalibrateClick}
                className="bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded text-xs transition-colors"
              >
                Calibrate
              </button>
            ) : (
              <button
                onClick={handleCancelCalibration}
                className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs transition-colors"
              >
                Cancel Calibration
              </button>
            )}
          </div>
        </div>

        {/* Calibration UI */}
        <CalibrationUI
          isCalibrating={isCalibrating}
          currentStep={currentCalibrationStep}
          jointToServoId={JOINT_TO_SERVO_ID}
          robot3DRef={robotRef}
          onCalibrationComplete={handleCalibrationComplete}
        />

        {/* Robot controls - only show when not calibrating */}
        {robot && !isCalibrating ? (
          <RobotControls
            robot={robot}
            onJointChange={handleJointChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            jointValues={jointAngles}
            isCalibrating={false}
            torqueEnabled={torqueEnabled}
          />
        ) : robot && isCalibrating ? null : (
          <div className="bg-white/90 rounded-lg p-4 text-gray-800 font-medium">
            Loading robot controls...
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
