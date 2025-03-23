import { useCallback, useEffect, useRef, useState } from "react";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";
import { getServoPositions, WS_URL } from "./services/ServoAPI";

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
          if (data.type === "servo_positions" && data.positions) {
            // Skip updates entirely while user is dragging a slider
            if (isDraggingRef.current) {
              console.log("Ignoring server position update during slider drag");
              return;
            }

            // Only update if we have a robot and aren't currently updating from other sources
            if (robotRef.current && !updatingFromServer.current) {
              const now = Date.now();

              // Throttle updates to avoid excessive rendering
              if (now - lastUpdateTimeRef.current > throttleTimeMs) {
                // Prevent recursive updates
                updatingFromServer.current = true;

                // Update 3D model joints with servo positions
                let hasChanges = false;
                const newAngles = { ...jointAngles };

                Object.entries(data.positions).forEach(([servoId, degrees]) => {
                  const jointName = SERVO_TO_JOINT_MAP[servoId];
                  if (jointName && robotRef.current.joints[jointName]) {
                    // Convert degrees to radians for 3D model
                    const newRadians = ((degrees as number) * Math.PI) / 180;

                    // Update the 3D model directly
                    robotRef.current.setJointValue(jointName, newRadians);

                    // Update our joint angle state only if it changed significantly
                    if (Math.abs(newAngles[jointName] - newRadians) > 0.01) {
                      newAngles[jointName] = newRadians;
                      hasChanges = true;
                    }
                  }
                });

                // Only update state if there were actual changes
                if (hasChanges) {
                  setJointAngles(newAngles);
                }

                lastUpdateTimeRef.current = now;

                // Schedule re-enabling updates
                setTimeout(() => {
                  updatingFromServer.current = false;
                }, 100);
              }
            }
          } else if (data.type === "ack") {
            // Server acknowledged our message
            updateConnectionStatus("connected");
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
  }, [jointAngles, updateConnectionStatus]);

  // Initialize WebSocket connection with protection against React's double-mount behavior
  useEffect(() => {
    // Mark that we're in the mounting phase
    isMountingRef.current = true;

    // Fetch initial servo positions via HTTP API when component mounts
    const fetchInitialPositions = async () => {
      try {
        const positions = await getServoPositions();

        // Only update if we have a robot and positions
        if (robotRef.current && positions) {
          updatingFromServer.current = true;

          // Update the 3D model with initial positions
          Object.entries(positions).forEach(([servoId, degrees]) => {
            const jointName = SERVO_TO_JOINT_MAP[servoId];
            if (jointName && robotRef.current.joints[jointName]) {
              // Convert degrees to radians for 3D model
              const radians = ((degrees as number) * Math.PI) / 180;
              robotRef.current.setJointValue(jointName, radians);

              // Update joint angles state
              setJointAngles((prev) => ({
                ...prev,
                [jointName]: radians,
              }));
            }
          });

          setTimeout(() => {
            updatingFromServer.current = false;
          }, 100);
        }
      } catch (error) {
        console.error("Failed to fetch initial positions:", error);
      }
    };

    // Fetch initial positions
    fetchInitialPositions();

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
          <button
            onClick={handleCenterAll}
            className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            Center All
          </button>
        </div>

        {/* Robot controls */}
        {robot ? (
          <RobotControls
            robot={robot}
            onJointChange={handleJointChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            jointValues={jointAngles}
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
