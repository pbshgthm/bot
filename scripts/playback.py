# playback.py
import time
import json
import sys
import os
from servo_controller import ServoController

def main():
    # Use a fixed recording file
    record_file = "recording.json"
    
    if not os.path.isfile(record_file):
        print(f"File not found: {record_file}")
        sys.exit(1)
    
    # Load the recorded data
    with open(record_file, 'r') as f:
        record_data = json.load(f)
    
    # Instantiate the servo controller
    controller = ServoController()
    
    # Connect to the servo bus
    controller.connect()
    
    # Enable torque so we can precisely replay the recorded positions
    controller._write("Torque_Enable", 1)
    
    print(f"Replaying movements from: {record_file}")
    
    # Get the list of recorded samples
    records = record_data.get("records", [])
    
    # Record the local start time to track relative playback time
    playback_start = time.time()
    
    for entry in records:
        target_time = entry["timestamp"]  # when (relative to start) this frame was recorded
        positions = entry["positions"]    # dictionary of servo_name -> position
        
        # Wait until we reach that relative time
        # (so playback speed matches original recording speed)
        while (time.time() - playback_start) < target_time:
            time.sleep(0.001)
        
        # Command the servos to move to the recorded positions
        controller.move_to_positions(positions)  # speed can be adjusted as desired

    print("Playback finished. Moving all servos to center (optional).")
    controller.center()
    
    # Disconnect
    controller.disconnect()

if __name__ == "__main__":
    main()
