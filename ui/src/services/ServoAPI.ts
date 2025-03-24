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
        console.log(`WebSocket message received: ${event.data}`);
        const data = JSON.parse(event.data);

        // First check if it's a response to a pending request regardless of type
        if (data.requestId && pendingRequests.has(data.requestId)) {
          console.log(
            `Found matching request for ${data.requestId}, type: ${data.type}`
          );
          const pendingRequest = pendingRequests.get(data.requestId);

          if (data.type === "error") {
            // Handle error response
            console.error(
              `Received error for request ${data.requestId}:`,
              data.message
            );
            if (pendingRequest) {
              pendingRequest.reject(new Error(data.message));
              pendingRequests.delete(data.requestId);
            }
          } else {
            // Handle successful response (any type)
            console.log(
              `Resolving request ${data.requestId} with response type: ${data.type}`
            );
            if (pendingRequest) {
              pendingRequest.resolve(data);
              pendingRequests.delete(data.requestId);
            }
          }

          // Continue processing for broadcast handlers below
        }

        // Now handle different message types for broadcast purposes
        if (data.type === "servo_positions") {
          // Handle regular position updates
          console.log(`Received servo positions broadcast`, data.positions);
          // These are broadcast and don't need request ID matching
        } else if (
          data.type === "calibration_step" ||
          data.type === "calibration_complete" ||
          data.type === "position_captured"
        ) {
          // Log calibration-related messages in more detail
          console.log(`Received calibration message type=${data.type}:`, data);
          // These messages are passed up to the application
        } else if (data.type === "error" && !data.requestId) {
          // Handle broadcast errors (not tied to a request)
          console.error(`Received broadcast error:`, data.message);
        } else {
          console.log(`Received other WebSocket message:`, data);
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error, event.data);
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

  console.log(`Preparing to send WebSocket request:`, request);

  return new Promise((resolve, reject) => {
    // Store the promise callbacks with the request ID
    pendingRequests.set(requestId, { resolve, reject });

    // Set a timeout to clean up abandoned requests
    // Use longer timeout for specific request types
    const isTorqueRequest =
      request.type &&
      (request.type === "get_torque_enabled" ||
        request.type === "set_torque_enabled");
    const isCalibrationRequest =
      request.type && request.type.includes("calibration");

    // Longer timeouts for special operations
    let timeoutMs = 10000; // Default: 10 seconds
    if (isCalibrationRequest) {
      timeoutMs = 30000; // 30 seconds for calibration
    } else if (isTorqueRequest) {
      timeoutMs = 15000; // 15 seconds for torque operations
    }

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        console.error(
          `WebSocket request timed out after ${
            timeoutMs / 1000
          }s: ${requestId}`,
          request
        );
        reject(
          new Error(
            `WebSocket request timed out after ${timeoutMs / 1000} seconds`
          )
        );
      }
    }, timeoutMs);

    // Send the request
    try {
      const message = JSON.stringify(request);
      console.log(`Sending WebSocket message: ${message}`);
      ws.send(message);
    } catch (error) {
      console.error(`Error sending WebSocket message:`, error, request);
      reject(error);
    }
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
 * @param servoId - The servo identifier (numeric ID)
 * @param position - Position in degrees (-90 to 90)
 * @returns Promise with the updated servo info
 */
export const updateServoPosition = async (
  servoId: number,
  position: number
): Promise<{ success: boolean; servo_id: number; position: number }> => {
  console.log(
    `updateServoPosition called with servoId=${servoId}, position=${position}`
  );

  try {
    // Send update via WebSocket
    const request = {
      type: "servo_update",
      servo_id: servoId,
      position: position,
    };

    console.log(`Sending servo update request:`, request);
    const response = await sendWebSocketRequest(request);
    console.log(`Received servo update response:`, response);

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

/**
 * Start calibration process
 * This initiates the calibration sequence by releasing torque on all servos
 * @returns Promise indicating success
 */
export const startCalibration = async (): Promise<{ success: boolean }> => {
  try {
    console.log("Sending start_calibration request via WebSocket");
    // Send start calibration command via WebSocket
    await sendWebSocketRequest({
      type: "start_calibration",
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to start calibration:", error);
    throw error;
  }
};

/**
 * Set current calibration step
 * This sets the UI to the specified calibration step
 * @param servoId - The servo ID to calibrate
 * @param angle - The target angle (0, 90, or -90)
 * @param stepNumber - The current step number
 * @param totalSteps - The total number of steps
 * @returns Promise with acknowledgment
 */
export const setCalibrationStep = async (
  servoId: string | number,
  angle: number,
  stepNumber: number,
  totalSteps: number
): Promise<{ success: boolean }> => {
  try {
    console.log(
      `Setting calibration step for servo ${servoId} at ${angle}° (step ${stepNumber}/${totalSteps})`
    );
    // Send calibration step command via WebSocket
    await sendWebSocketRequest({
      type: "set_calibration_step",
      joint: servoId.toString(),
      angle: angle,
      step_number: stepNumber,
      total_steps: totalSteps,
    });

    return { success: true };
  } catch (error) {
    console.error(`Failed to set calibration step for ${servoId}:`, error);
    throw error;
  }
};

/**
 * Capture calibration position
 * This captures the current position for a specific servo at a specific angle
 * @param servoId - The servo ID (numeric ID as a string or number)
 * @param angle - The target angle (0, 90, or -90)
 * @param stepNumber - The current step number in the calibration sequence
 * @returns Promise with the captured position details
 */
export const captureCalibrationPosition = async (
  servoId: string | number,
  angle: number,
  stepNumber: number
): Promise<{ success: boolean; position: number }> => {
  try {
    console.log(
      `Sending capture_position request for servo ${servoId} at ${angle}° (step ${stepNumber})`
    );
    // Send capture position command via WebSocket
    const response = await sendWebSocketRequest({
      type: "capture_position",
      joint: servoId.toString(),
      angle: angle,
      step_number: stepNumber,
    });

    return {
      success: true,
      position: response.position || 0,
    };
  } catch (error) {
    console.error(`Failed to capture position for ${servoId}:`, error);
    throw error;
  }
};

/**
 * End calibration process
 * This completes the calibration sequence and enables torque on all servos
 * @returns Promise indicating success
 */
export const endCalibration = async (): Promise<{ success: boolean }> => {
  try {
    console.log("Sending end_calibration request via WebSocket");
    // Send end calibration command via WebSocket
    await sendWebSocketRequest({
      type: "end_calibration",
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to end calibration:", error);
    throw error;
  }
};

/**
 * Get current torque enabled status
 * @returns Promise with torque status
 */
export const getTorqueEnabled = async (): Promise<boolean> => {
  try {
    // Request torque status via WebSocket
    const response = await sendWebSocketRequest({
      type: "get_torque_enabled",
    });

    return response.enabled;
  } catch (error) {
    console.error("Failed to get torque status:", error);
    throw error;
  }
};

/**
 * Set torque enabled status for all servos
 * @param enabled - Whether to enable or disable torque
 * @returns Promise indicating success
 */
export const setTorqueEnabled = async (
  enabled: boolean
): Promise<{ success: boolean }> => {
  try {
    // Send torque command via WebSocket
    await sendWebSocketRequest({
      type: "set_torque_enabled",
      enabled: enabled,
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to set torque status:", error);
    throw error;
  }
};
