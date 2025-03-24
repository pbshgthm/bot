import React, { useCallback, useEffect } from "react";
import {
  captureCalibrationPosition,
  endCalibration,
  setCalibrationStep,
} from "../services/ServoAPI";

interface CalibrationUIProps {
  isCalibrating: boolean;
  currentStep: {
    joint: string;
    angle: number;
    current_step?: number;
    total_steps?: number;
  } | null;
  jointToServoId: Record<string, number>;
  robot3DRef: any;
  onCalibrationComplete: () => void;
}

const CalibrationUI: React.FC<CalibrationUIProps> = ({
  isCalibrating,
  currentStep,
  jointToServoId,
  robot3DRef,
  onCalibrationComplete,
}) => {
  const [captureSuccess, setCaptureSuccess] = React.useState(false);

  // Get the joint name by servo ID
  const getJointNameById = useCallback(
    (servoId: number): string | undefined => {
      return Object.entries(jointToServoId).find(
        ([_, id]) => id === servoId
      )?.[0];
    },
    [jointToServoId]
  );

  // Update 3D model when calibration step changes
  useEffect(() => {
    if (isCalibrating && currentStep && robot3DRef.current) {
      const { joint, angle } = currentStep;
      const servoId = Number(joint);
      const jointName = getJointNameById(servoId);

      if (!jointName) return;

      // Reset all joints to zero except active joint
      Object.keys(robot3DRef.current.joints).forEach((robotJointName) => {
        if (jointName && robotJointName === jointName) {
          // Set the active joint to the calibration angle
          const radians = (angle * Math.PI) / 180;
          robot3DRef.current.setJointValue(robotJointName, radians);
        } else {
          robot3DRef.current.setJointValue(robotJointName, 0);
        }
      });
    }
  }, [currentStep, isCalibrating, getJointNameById, robot3DRef]);

  const handleCapturePosition = useCallback(() => {
    if (!currentStep) return;

    const { joint, angle, current_step } = currentStep;
    const stepNumber = current_step || 1;
    const servoId = Number(joint);

    // Show success immediately for better user experience
    setCaptureSuccess(true);
    setTimeout(() => setCaptureSuccess(false), 1500);

    // Send the capture request
    captureCalibrationPosition(servoId.toString(), angle, stepNumber)
      .then(() => {
        // Move to next step
        const allServos = Object.values(jointToServoId) as number[];
        const allAngles = [0, 90, -90]; // Zero, max, min

        // Find current position in sequence
        const currentServoIndex = allServos.findIndex((id) => id === servoId);
        const currentAngleIndex = allAngles.findIndex((a) => a === angle);

        if (currentServoIndex >= 0 && currentAngleIndex >= 0) {
          // Calculate next position
          let nextAngleIndex = (currentAngleIndex + 1) % allAngles.length;
          let nextServoIndex = currentServoIndex;

          // If we've gone through all angles for this joint, move to the next joint
          if (nextAngleIndex === 0) {
            nextServoIndex = (currentServoIndex + 1) % allServos.length;
          }

          // Check if we've completed the full cycle
          if (
            nextServoIndex === 0 &&
            nextAngleIndex === 0 &&
            (currentServoIndex > 0 || currentAngleIndex > 0)
          ) {
            // We've completed the full cycle
            endCalibration()
              .then(() => {
                onCalibrationComplete();
              })
              .catch((error) => {
                alert("Failed to end calibration. See console for details.");
              });
          } else {
            // Move to the next step
            const nextServoId = allServos[nextServoIndex];
            const nextAngle = allAngles[nextAngleIndex];
            const totalSteps = allServos.length * allAngles.length;
            const nextStep =
              nextServoIndex * allAngles.length + nextAngleIndex + 1;

            // Send to server
            setCalibrationStep(
              nextServoId,
              nextAngle,
              nextStep,
              totalSteps
            ).catch(() => {
              alert("Failed to move to next calibration step.");
            });
          }
        }
      })
      .catch(() => {
        setCaptureSuccess(false);
        alert("Failed to capture position.");
      });
  }, [currentStep, jointToServoId, onCalibrationComplete]);

  if (!isCalibrating || !currentStep) {
    return null;
  }

  return (
    <div className="bg-white/95 backdrop-blur-md rounded-lg p-4 mb-2 border-2 border-orange-500">
      <h3 className="text-lg font-bold mb-3 text-orange-600">
        Calibration Mode
      </h3>
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>
            Step {currentStep.current_step} of {currentStep.total_steps}
          </span>
          <span>
            {Math.round(
              ((currentStep.current_step || 0) /
                (currentStep.total_steps || 1)) *
                100
            )}
            %
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-orange-500 h-2 rounded-full"
            style={{
              width: `${Math.round(
                ((currentStep.current_step || 0) /
                  (currentStep.total_steps || 1)) *
                  100
              )}%`,
            }}
          ></div>
        </div>
      </div>

      <div className="bg-orange-50 rounded-lg p-4 mb-4 border border-orange-200">
        <h4 className="text-base font-bold mb-2 text-gray-800">
          Current Task:
        </h4>

        <div className="flex items-center justify-center mb-3">
          <div className="bg-orange-100 rounded-full px-4 py-2 font-bold text-orange-800">
            {getJointNameById(Number(currentStep.joint)) ||
              `Joint ${currentStep.joint}`}
          </div>
          <div className="mx-2 text-gray-400">→</div>
          <div className="bg-blue-100 rounded-full px-4 py-2 font-bold text-blue-800">
            {currentStep.angle}°
          </div>
        </div>

        <div className="text-sm text-gray-700 bg-white p-3 rounded border border-gray-200">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Manually position the{" "}
              <strong className="text-orange-600">
                {getJointNameById(Number(currentStep.joint)) ||
                  `Joint ${currentStep.joint}`}
              </strong>{" "}
              joint to{" "}
              <strong className="text-blue-600">{currentStep.angle}°</strong>
            </li>
            <li>Check the 3D model to see the correct position</li>
            <li>
              Click "Capture Position" when the joint is properly positioned
            </li>
          </ol>
        </div>
      </div>

      <button
        onClick={handleCapturePosition}
        className={`w-full ${
          captureSuccess
            ? "bg-green-600 hover:bg-green-700"
            : "bg-green-500 hover:bg-green-600"
        } text-white py-3 rounded-lg font-medium text-base transition-colors relative`}
        disabled={captureSuccess}
      >
        {captureSuccess ? (
          <span className="flex items-center justify-center">
            <svg
              className="w-5 h-5 mr-2"
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
          <span className="flex items-center justify-center">
            <svg
              className="w-5 h-5 mr-2"
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
            Capture Position
          </span>
        )}
      </button>
    </div>
  );
};

export default CalibrationUI;
