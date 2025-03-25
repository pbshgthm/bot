/**
 * ServoAPI service
 * Handles communication with the servo controller via REST API and SSE for updates
 */

// Define the base API URL
export const API_BASE_URL = "http://localhost:1212/api";
export const SSE_URL = `${API_BASE_URL}/events`;

// Keep track of the SSE connection
let eventSource: EventSource | null = null;
let eventListeners: Map<string, Set<(data: any) => void>> = new Map();

export interface ServoPositions {
  [key: string]: number; // Index signature for dynamic access
}

/**
 * Initialize and get SSE connection for real-time updates
 */
export const initSSE = (): EventSource => {
  if (eventSource && eventSource.readyState === EventSource.OPEN) {
    return eventSource;
  }

  // Close existing connection if it's not closed
  if (eventSource) {
    eventSource.close();
  }

  // Create new connection
  eventSource = new EventSource(SSE_URL);

  eventSource.onopen = () => {
    // SSE connection established
  };

  eventSource.onerror = () => {
    // SSE connection error, attempt to reconnect after a delay
    setTimeout(() => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
        initSSE();
      }
    }, 3000);
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Dispatch to any registered listeners for this event type
      const listeners = eventListeners.get(data.type);
      if (listeners) {
        listeners.forEach((callback) => {
          callback(data);
        });
      }
    } catch (error) {
      // Error processing SSE message
    }
  };

  return eventSource;
};

/**
 * Register a listener for SSE events of a specific type
 */
export const addSSEListener = (
  eventType: string,
  callback: (data: any) => void
): (() => void) => {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, new Set());
  }

  const listeners = eventListeners.get(eventType)!;
  listeners.add(callback);

  // Ensure SSE is initialized
  initSSE();

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
 * Make API request with proper error handling
 */
const fetchAPI = async (
  endpoint: string,
  method: string = "GET",
  data?: any
): Promise<any> => {
  const url = `${API_BASE_URL}/${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (data && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return response.json();
};

/**
 * Get current positions of all servos
 */
export const getServoPositions = async (): Promise<ServoPositions> => {
  try {
    const response = await fetchAPI("positions");
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
    const response = await fetchAPI("servo", "POST", {
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
    const response = await fetchAPI("calibration/start", "POST");
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};

/**
 * Capture a calibration position - updated for client-driven calibration
 *
 * @param servoId - The ID of the servo being calibrated
 * @param angle - The calibration angle (0 for center, 90 for max, -90 for min)
 * @param stepNumber - The current step in the calibration process
 */
export const captureCalibrationPosition = async (
  servoId: string | number,
  angle: number,
  stepNumber: number
): Promise<{ success: boolean; position: number }> => {
  try {
    const response = await fetchAPI("calibration/capture", "POST", {
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
    const response = await fetchAPI("calibration/complete", "POST");
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
    const response = await fetchAPI("calibration/cancel", "POST");
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
    const response = await fetchAPI("torque");
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
    const response = await fetchAPI("torque", "POST", { enabled });
    return { success: response.status === "success" };
  } catch (error) {
    throw error;
  }
};
