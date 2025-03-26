/**
 * ServoAPI service
 * Handles communication with the servo controller via Socket.io
 */

import { io, Socket } from "socket.io-client";

// Socket connection config
const SOCKET_URL = "http://localhost:1212";
let socket: Socket | null = null;
let eventListeners: Map<string, Set<(data: any) => void>> = new Map();

export interface ServoPositions {
  [key: string]: number; // Index signature for dynamic access
}

/**
 * Initialize socket connection
 */
export const initSocket = (): Socket => {
  if (socket && socket.connected) {
    return socket;
  }

  // Close existing connection if it exists
  if (socket) {
    socket.disconnect();
  }

  // Create new connection
  socket = io(SOCKET_URL, {
    reconnectionDelay: 1000,
    reconnection: true,
    transports: ["websocket"],
  });

  // Set up event forwarding to registered listeners
  socket.onAny((eventName, data) => {
    const listeners = eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  });

  return socket;
};

/**
 * Register a listener for socket events
 */
export const addSocketListener = (
  eventType: string,
  callback: (data: any) => void
): (() => void) => {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, new Set());
  }

  const listeners = eventListeners.get(eventType)!;
  listeners.add(callback);

  // Ensure socket is initialized
  initSocket();

  // Return a cleanup function
  return () => {
    const listeners = eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        eventListeners.delete(eventType);
      }
    }
  };
};

/**
 * Emit event and get response
 */
const emitWithAck = async (event: string, data?: any): Promise<any> => {
  const currentSocket = initSocket();

  return new Promise((resolve, reject) => {
    currentSocket.emit(event, data, (response: any) => {
      if (response.status === "error") {
        reject(new Error(response.message));
      } else {
        resolve(response);
      }
    });
  });
};

/**
 * Get current positions of all servos
 */
export const getServoPositions = async (): Promise<ServoPositions> => {
  try {
    const response = await emitWithAck("get_positions");
    return response.positions;
  } catch (error) {
    throw error;
  }
};

/**
 * Update a single servo position
 */
export const updateServoPosition = async (
  servoId: number,
  position: number
): Promise<{ success: boolean; servo_id: number; position: number }> => {
  try {
    const response = await emitWithAck("update_servo", {
      servo_id: servoId,
      position,
    });

    return {
      success: response.status === "success",
      servo_id: servoId,
      position,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Start the calibration process
 */
export const startCalibration = async (): Promise<{ success: boolean }> => {
  try {
    const response = await emitWithAck("calibration_start");
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};

/**
 * Capture a calibration position
 */
export const captureCalibrationPosition = async (
  servoId: string | number,
  angle: number,
  stepNumber: number
): Promise<{ success: boolean; position: number }> => {
  try {
    const response = await emitWithAck("calibration_capture", {
      joint: servoId.toString(),
      angle,
      step_number: stepNumber,
    });

    return {
      success: response.status === "success",
      position: response.position,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Complete the calibration process
 */
export const endCalibration = async (): Promise<{ success: boolean }> => {
  try {
    const response = await emitWithAck("calibration_complete");
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};

/**
 * Cancel the calibration process
 */
export const cancelCalibration = async (): Promise<{ success: boolean }> => {
  try {
    const response = await emitWithAck("calibration_cancel");
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};

/**
 * Get current torque enabled status
 */
export const getTorqueEnabled = async (): Promise<boolean> => {
  try {
    const response = await emitWithAck("get_torque");
    return response.enabled;
  } catch (error) {
    throw error;
  }
};

/**
 * Set torque enabled status
 */
export const setTorqueEnabled = async (
  enabled: boolean
): Promise<{ success: boolean }> => {
  try {
    const response = await emitWithAck("set_torque", { enabled });
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};
