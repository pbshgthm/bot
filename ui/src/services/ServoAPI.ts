/**
 * ServoAPI service
 * Handles communication with the servo controller via WebSocket
 */

// Define the WebSocket URL for real-time servo updates
export const WS_URL = "ws://localhost:1212/ws";

// Keep track of the WebSocket connection
let websocket: WebSocket | null = null;
let pendingRequests: Map<string, { resolve: Function; reject: Function }> =
  new Map();
let requestIdCounter = 0;

export interface ServoPositions {
  base_yaw: number;
  pitch: number;
  pitch2: number;
  pitch3: number;
  roll: number;
  grip: number;
  [key: string]: number; // Index signature for dynamic access
}

/**
 * Initialize and get WebSocket connection
 * @returns Promise with the WebSocket connection
 */
const getWebSocket = (): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    // Return existing connection if it's open
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      return resolve(websocket);
    }

    // Close existing connection if it's not open
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
      websocket.close();
    }

    // Create new connection
    websocket = new WebSocket(WS_URL);

    websocket.onopen = () => {
      console.log("WebSocket connection established");
      resolve(websocket!);
    };

    websocket.onclose = () => {
      console.log("WebSocket connection closed");
      websocket = null;
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      reject(error);
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle different message types
        if (data.type === "servo_positions") {
          // Handle regular position updates
          // These are broadcast and don't need request ID matching
        } else if (data.type === "ack" && data.requestId) {
          // Handle acknowledgment for a specific request
          const pendingRequest = pendingRequests.get(data.requestId);
          if (pendingRequest) {
            pendingRequest.resolve(data);
            pendingRequests.delete(data.requestId);
          }
        } else if (data.type === "error" && data.requestId) {
          // Handle errors for a specific request
          const pendingRequest = pendingRequests.get(data.requestId);
          if (pendingRequest) {
            pendingRequest.reject(new Error(data.message));
            pendingRequests.delete(data.requestId);
          }
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    };
  });
};

/**
 * Send a request via WebSocket with response tracking
 */
const sendWebSocketRequest = async (request: any): Promise<any> => {
  const ws = await getWebSocket();

  // Generate a unique request ID
  const requestId = `req_${Date.now()}_${requestIdCounter++}`;
  request.requestId = requestId;

  return new Promise((resolve, reject) => {
    // Store the promise callbacks with the request ID
    pendingRequests.set(requestId, { resolve, reject });

    // Set a timeout to clean up abandoned requests
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error("WebSocket request timed out"));
      }
    }, 5000); // 5 second timeout

    // Send the request
    ws.send(JSON.stringify(request));
  });
};

/**
 * Get current positions of all servos
 * @returns Promise with servo positions
 */
export const getServoPositions = async (): Promise<ServoPositions> => {
  try {
    // Request positions via WebSocket
    const response = await sendWebSocketRequest({
      type: "get_positions",
    });

    return response.positions;
  } catch (error) {
    console.error("Failed to get servo positions:", error);
    throw error;
  }
};

/**
 * Update a single servo position
 * @param servoId - The servo identifier (base_yaw, pitch, pitch2, etc.)
 * @param position - Position in degrees (-90 to 90)
 * @returns Promise with the updated servo info
 */
export const updateServoPosition = async (
  servoId: string,
  position: number
): Promise<{ success: boolean; servo_id: string; position: number }> => {
  try {
    // Send update via WebSocket
    const response = await sendWebSocketRequest({
      type: "servo_update",
      servo_id: servoId,
      position: position,
    });

    return {
      success: true,
      servo_id: servoId,
      position: position,
    };
  } catch (error) {
    console.error(`Failed to update servo ${servoId}:`, error);
    throw error;
  }
};

/**
 * Center all servos (reset to 0 degrees)
 * @returns Promise indicating success
 */
export const centerAllServos = async (): Promise<{ success: boolean }> => {
  try {
    // Send center command via WebSocket
    await sendWebSocketRequest({
      type: "center_all",
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to center servos:", error);
    throw error;
  }
};
