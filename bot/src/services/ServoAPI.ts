/**
 * ServoAPI service
 * Handles communication with the servo controller API
 */

// Define the API base URL - defaults to localhost:1212 (matches server.py default)
const API_BASE_URL = "http://localhost:1212/api/servo";

export interface ServoPositions {
  base_yaw: number;
  pitch: number;
  pitch2: number;
  pitch3: number;
  pitch4: number;
  pitch5: number;
  [key: string]: number; // Index signature for dynamic access
}

/**
 * Get current positions of all servos
 * @returns Promise with servo positions
 */
export const getServoPositions = async (): Promise<ServoPositions> => {
  try {
    const response = await fetch(`${API_BASE_URL}/positions`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
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
    const response = await fetch(`${API_BASE_URL}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        servo_id: servoId,
        position: position,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
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
    const response = await fetch(`${API_BASE_URL}/center`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to center servos:", error);
    throw error;
  }
};
