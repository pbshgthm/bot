import React, { useCallback, useEffect, useState } from "react";
import {
  captureCalibrationPosition,
  endCalibration,
} from "../services/ServoAPI";

interface CalibrationUIProps {
  jointToServoIdMap: Record<string, number>;
  allServoIds: number[];
  onComplete: () => void;
  updateRobotModel: (jointName: string, angleDegrees: number) => void;
}

// Define the calibration positions in the sequence they should be captured
const CALIBRATION_POSITIONS = [
  { angle: 0, label: "Center (0°)" },
  { angle: 90, label: "Maximum (90°)" },
  { angle: -90, label: "Minimum (-90°)" },
];

const CalibrationUI: React.FC<CalibrationUIProps> = ({
  jointToServoIdMap,
  allServoIds,
  onComplete,
  updateRobotModel,
}) => {
  // Track the current servo being calibrated
  const [currentServoIndex, setCurrentServoIndex] = useState(0);
  // Track the current position being calibrated for the current servo
  const [currentPositionIndex, setCurrentPositionIndex] = useState(0);

  // Calculate total steps
  const totalSteps = allServoIds.length * CALIBRATION_POSITIONS.length;
  const currentStep =
    currentServoIndex * CALIBRATION_POSITIONS.length + currentPositionIndex + 1;

  // Get current servo ID and joint name
  const currentServoId = allServoIds[currentServoIndex];
  const currentJointName =
    Object.entries(jointToServoIdMap).find(
      ([_, id]) => id === currentServoId
    )?.[0] || String(currentServoId);

  // Get current angle to calibrate
  const currentPosition = CALIBRATION_POSITIONS[currentPositionIndex];
  const currentAngle = currentPosition.angle;

  // Update the 3D model when the current servo or position changes
  useEffect(() => {
    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
      // Update the 3D model to show the target position
      updateRobotModel(currentJointName, currentAngle);
    });
  }, [
    currentServoIndex,
    currentPositionIndex,
    currentJointName,
    currentAngle,
    updateRobotModel,
  ]);

  // Get the joint name to display
  const getDisplayName = (jointName: string): string => {
    return jointName || "Unknown Joint";
  };

  const handleCapturePosition = useCallback(() => {
    // Send the capture request immediately without visual change
    captureCalibrationPosition(currentServoId, currentAngle, currentStep)
      .then(() => {
        // Move to next position or servo immediately
        if (currentPositionIndex < CALIBRATION_POSITIONS.length - 1) {
          // Move to next position for the same servo
          setCurrentPositionIndex(currentPositionIndex + 1);
        } else if (currentServoIndex < allServoIds.length - 1) {
          // Move to next servo, reset position index
          setCurrentServoIndex(currentServoIndex + 1);
          setCurrentPositionIndex(0);
        } else {
          // Calibration complete - all servos and positions done
          endCalibration()
            .then(() => {
              onComplete();
            })
            .catch(() => {
              // Handle error
            });
        }
      })
      .catch(() => {
        // Handle error silently
      });
  }, [
    currentServoId,
    currentAngle,
    currentStep,
    currentPositionIndex,
    currentServoIndex,
    allServoIds,
    onComplete,
  ]);

  return (
    <div className="bg-white/90 backdrop-blur rounded-lg p-3 overflow-y-auto max-h-full shadow-md">
      {/* Header with step progress */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-600">Calibration</span>
        <span className="text-xs text-gray-500 font-medium">
          {currentStep}/{totalSteps}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="w-full bg-gray-100 rounded-full h-1">
          <div
            className="bg-gray-400 h-1 rounded-full"
            style={{
              width: `${Math.round((currentStep / totalSteps) * 100)}%`,
            }}
          ></div>
        </div>
      </div>

      {/* Current joint/position to calibrate - simplified */}
      <div className="flex items-center justify-center mb-2.5 text-xs">
        <div className="bg-gray-100 rounded-full px-2 py-1 font-medium text-gray-700">
          {getDisplayName(currentJointName)}
        </div>
        <div className="mx-1.5 text-gray-400">→</div>
        <div className="bg-gray-100 rounded-full px-2 py-1 font-medium text-gray-700">
          {currentPosition.label}
        </div>
      </div>

      {/* Simple instruction text */}
      <div className="text-xs text-gray-500 mb-3 text-center">
        Position joint to shown angle, then tap Capture
      </div>

      {/* Action buttons */}
      <div className="flex space-x-2">
        <button
          onClick={onComplete}
          className="flex-1 px-3 py-1.5 bg-gray-400 hover:bg-gray-500 text-white text-xs rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleCapturePosition}
          className="flex-1 bg-green-400 active:bg-green-600 hover:bg-green-500 text-white py-1.5 px-3 rounded text-xs"
        >
          <span className="flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 mr-1"
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
            Capture
          </span>
        </button>
      </div>
    </div>
  );
};

export default CalibrationUI;
