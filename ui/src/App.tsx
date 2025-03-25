import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalibrationUI from "./components/CalibrationUI";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";
import {
  addSSEListener,
  cancelCalibration,
  getServoPositions,
  getTorqueEnabled,
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
  // Throttle UI updates from SSE
  const lastUpdateTimeRef = useRef(0);
  const throttleTimeMs = 50;
  // Track connection status internally to avoid multiple state updates
  const connectedRef = useRef(false);
  // Track SSE cleanup function
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  // Torque enabled state
  const [torqueEnabled, setTorqueEnabledState] = useState(true);
  // Track position update timeout
  const updatePositionTimeoutRef = useRef<number | null>(null);

  // Memoize all servo IDs to prevent unnecessary renders
  const allServoIds = useMemo(() => Object.values(JOINT_TO_SERVO_ID), []);

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
    [serverStatus]
  );

  // Set up SSE connection for real-time updates
  useEffect(() => {
    // Set up SSE listener for servo position updates
    const cleanup = addSSEListener("servo_positions", (data) => {
      const lastUpdateTime = lastUpdateTimeRef.current;
      const currentTime = Date.now();

      if (
        data.positions &&
        !isDraggingRef.current &&
        !updatingFromServer.current &&
        currentTime - lastUpdateTime >= throttleTimeMs
      ) {
        // Update throttle timestamp
        lastUpdateTimeRef.current = currentTime;

        if (robotRef.current) {
          updatingFromServer.current = true;

          try {
            // Use batch updates for better performance
            requestAnimationFrame(() => {
              try {
                // Update each joint in the 3D model based on servo ID
                const newAngles: Record<string, number> = { ...jointAngles };
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

                      // Update the 3D model joint directly
                      robotRef.current.setJointValue(jointName, radians);

                      // Update our local state
                      if (
                        !newAngles[jointName] ||
                        Math.abs(newAngles[jointName] - degreeValue) > 0.1
                      ) {
                        newAngles[jointName] = degreeValue;
                        hasChanges = true;
                      }
                    }
                  }
                );

                // Only update state if something changed
                if (hasChanges) {
                  setJointAngles(newAngles);
                }
              } finally {
                updatingFromServer.current = false;
              }
            });
          } catch (error) {
            updatingFromServer.current = false;
            console.error("Error updating from SSE:", error);
          }
        }
      } else if (isDraggingRef.current) {
        console.log(
          "Ignoring server position update - user is dragging or in calibration mode"
        );
      }
    });

    // Store the cleanup function
    sseCleanupRef.current = cleanup;

    // Connection is considered established once we set up the listener
    updateConnectionStatus("connected");

    // Clean up SSE on unmount
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
    };
  }, [updateConnectionStatus, jointAngles]);

  // Handle torque toggle
  const handleTorqueToggle = useCallback(async () => {
    try {
      const newTorqueState = !torqueEnabled;
      await setTorqueEnabled(newTorqueState);
      setTorqueEnabledState(newTorqueState);
    } catch (error) {
      // Handle errors
    }
  }, [torqueEnabled]);

  // Handle slider updates
  const handleAngleChange = useCallback((jointName: string, angle: number) => {
    // Mark as dragging to prevent server updates from overriding user input
    isDraggingRef.current = true;

    if (robotRef.current) {
      // Get the servo ID
      const servoId = JOINT_TO_SERVO_ID[jointName];

      if (typeof servoId === "number") {
        // Convert to radians for the 3D model
        const radians = (angle * Math.PI) / 180;

        // Update the 3D model directly without waiting for state updates
        robotRef.current.setJointValue(jointName, radians);

        // Update the angle in our local state, but batch with other potential updates
        setJointAngles((prev) => ({
          ...prev,
          [jointName]: angle,
        }));

        // Use a debounced update to the server to reduce network traffic
        if (!updatePositionTimeoutRef.current) {
          updatePositionTimeoutRef.current = setTimeout(() => {
            updateServoPosition(servoId, angle).catch(() => {
              // Handle error
            });
            updatePositionTimeoutRef.current = null;
          }, 50);
        }
      }
    }
  }, []);

  // Update dragging state when done
  const handleDragEnd = useCallback(() => {
    // Release dragging but add a timeout before accepting updates
    // This gives time for our last command to be processed
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 300);
  }, []);

  // Initialize by getting the torque status
  useEffect(() => {
    async function initializeTorqueStatus() {
      try {
        const enabled = await getTorqueEnabled();
        setTorqueEnabledState(enabled);
      } catch (error) {
        // Handle errors
      }
    }

    initializeTorqueStatus();
  }, []);

  // Handle calibration start - updated for client-driven approach
  const handleStartCalibration = useCallback(async () => {
    try {
      setIsCalibrating(true);
      const result = await startCalibration();
      if (result.success) {
        // Disable SSE position updates during calibration by setting isDraggingRef
        // This prevents real servo positions from overriding our target positions
        isDraggingRef.current = true;

        // Reset all joints to 0 in the 3D model before starting calibration
        if (robotRef.current) {
          const initialAngles: Record<string, number> = {};
          Object.keys(JOINT_TO_SERVO_ID).forEach((jointName) => {
            if (robotRef.current.joints[jointName]) {
              robotRef.current.setJointValue(jointName, 0);
              initialAngles[jointName] = 0;
            }
          });
          setJointAngles(initialAngles);
        }

        setCalibrationMode(true);
      } else {
        setIsCalibrating(false);
      }
    } catch (error) {
      setIsCalibrating(false);
      // Handle errors
    }
  }, []);

  // Handle completing calibration
  const handleCompleteCalibration = useCallback(async () => {
    try {
      // Reset the 3D model to show real positions immediately
      if (robotRef.current) {
        // Apply current positions immediately to reduce perceived lag
        try {
          const positions = await getServoPositions();

          // Update model with current positions immediately
          Object.entries(positions).forEach(([servoIdStr, degrees]) => {
            const servoId = Number(servoIdStr);
            const jointName = getJointNameById(servoId);

            if (jointName && robotRef.current?.joints[jointName]) {
              const degreeValue =
                typeof degrees === "number"
                  ? degrees
                  : parseFloat(String(degrees));
              const radians = (degreeValue * Math.PI) / 180;
              robotRef.current.setJointValue(jointName, radians);
            }
          });

          // Update UI state
          setJointAngles((prevAngles) => {
            const newAngles = { ...prevAngles };
            Object.entries(positions).forEach(([servoIdStr, degrees]) => {
              const servoId = Number(servoIdStr);
              const jointName = getJointNameById(servoId);
              if (jointName) {
                const degreeValue =
                  typeof degrees === "number"
                    ? degrees
                    : parseFloat(String(degrees));
                newAngles[jointName] = degreeValue;
              }
            });
            return newAngles;
          });
        } catch (error) {
          console.error("Error getting initial positions:", error);
        }
      }

      // Update UI state
      setCalibrationMode(false);
      setIsCalibrating(false);

      // Now that model is updated, call API to complete calibration
      if (isCalibrating) {
        await cancelCalibration();
      }

      // Ensure torque is enabled correctly
      try {
        // Force enable torque explicitly
        await setTorqueEnabled(true);
        setTorqueEnabledState(true);

        // Verify torque state with retry mechanism
        let retryCount = 0;
        const verifyTorque = async () => {
          try {
            const torqueState = await getTorqueEnabled();
            if (!torqueState && retryCount < 3) {
              retryCount++;
              console.log(`Torque not enabled, retrying (${retryCount}/3)...`);
              await setTorqueEnabled(true);
              setTimeout(verifyTorque, 500);
            } else {
              setTorqueEnabledState(torqueState);
            }
          } catch (error) {
            console.error("Error verifying torque state:", error);
          }
        };

        // Start verification after a short delay
        setTimeout(verifyTorque, 500);
      } catch (error) {
        console.error("Error setting torque:", error);
      }

      // Reset flags and reconnect SSE with minimal delay
      updatingFromServer.current = false;

      // Re-enable SSE position updates
      setTimeout(() => {
        isDraggingRef.current = false;

        // Refresh SSE connection
        if (sseCleanupRef.current) {
          sseCleanupRef.current();
          const cleanup = addSSEListener("servo_positions", (data) => {
            if (
              data.positions &&
              !isDraggingRef.current &&
              !updatingFromServer.current
            ) {
              updatingFromServer.current = true;

              try {
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

                  Object.entries(data.positions).forEach(
                    ([servoIdStr, degrees]) => {
                      const servoId = Number(servoIdStr);
                      const jointName = getJointNameById(servoId);

                      if (jointName) {
                        // Update our local state with the degree value
                        const degreeValue =
                          typeof degrees === "number"
                            ? degrees
                            : parseFloat(String(degrees));
                        newAngles[jointName] = degreeValue;
                      }
                    }
                  );

                  return newAngles;
                });
              } finally {
                updatingFromServer.current = false;
              }
            }
          });

          sseCleanupRef.current = cleanup;
        }
      }, 100);
    } catch (error) {
      console.error("Error in handleCompleteCalibration:", error);
    }
  }, [isCalibrating]);

  // Function to update the 3D model with target positions during calibration
  const updateRobotModelForCalibration = useCallback(
    (jointName: string, angleDegrees: number) => {
      if (!robotRef.current) return;

      // Use requestAnimationFrame for smoother animation
      requestAnimationFrame(() => {
        const newJointAngles: Record<string, number> = {};

        // Only update joints that exist in the model
        Object.keys(JOINT_TO_SERVO_ID).forEach((jName) => {
          if (robotRef.current.joints[jName]) {
            // Set target angle based on whether this is the current joint
            const targetAngle = jName === jointName ? angleDegrees : 0;
            const radians = (targetAngle * Math.PI) / 180;

            // Apply to 3D model
            robotRef.current.setJointValue(jName, radians);
            newJointAngles[jName] = targetAngle;
          }
        });

        // Batch update UI state in one operation
        setJointAngles(newJointAngles);
      });
    },
    []
  );

  // Render the application
  return (
    <div className="w-full h-screen m-0 p-0 overflow-hidden relative">
      {/* 3D Viewer Container */}
      <div className="threejs-container w-full h-full">
        <URDFViewer onRobotLoaded={handleRobotLoaded} />
      </div>

      {/* Connection Status Indicator */}
      <div className="fixed top-3 left-3 z-50 bg-white/80 rounded px-2 py-1 shadow-sm text-xs">
        <div className="flex items-center">
          <div
            className={`h-2 w-2 rounded-full mr-1.5 ${
              serverStatus === "connected"
                ? "bg-green-400"
                : serverStatus === "connecting"
                ? "bg-yellow-400"
                : "bg-red-400"
            }`}
          ></div>
          <span className="text-gray-600">
            {serverStatus === "connected"
              ? "Connected"
              : serverStatus === "connecting"
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Controls Container - fixed position */}
      <div className="fixed top-3 right-3 w-64 max-h-[calc(100vh-1.5rem)] overflow-auto z-50 shadow-md pointer-events-auto">
        {calibrationMode ? (
          <CalibrationUI
            jointToServoIdMap={JOINT_TO_SERVO_ID}
            allServoIds={allServoIds}
            onComplete={handleCompleteCalibration}
            updateRobotModel={updateRobotModelForCalibration}
          />
        ) : (
          <RobotControls
            jointAngles={jointAngles}
            onAngleChange={handleAngleChange}
            onDragEnd={handleDragEnd}
            torqueEnabled={torqueEnabled}
            onTorqueToggle={handleTorqueToggle}
            onStartCalibration={handleStartCalibration}
            isCalibrating={isCalibrating}
          />
        )}
      </div>
    </div>
  );
}

export default App;
