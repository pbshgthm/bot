# record.py
import time
import json
import os
from servo_controller import ServoController

def main():
    # Instantiate your servo controller
    controller = ServoController()
    
    # Connect to the servo bus
    controller.connect()
    
    # Disable torque so you can move the servos by hand (if your hardware supports it)
    controller._write("Torque_Enable", 0)
    
    print("Recording servo positions... Move your servos by hand. Press Ctrl+C to stop.")
    
    # Initialize a data structure to store timestamps + positions
    start_time = time.time()
    record_data = {
        "start_time": start_time,
        "records": []
    }
    
    try:
        while True:
            # Get the current raw positions of all defined servos
            positions = controller.get_positions()
            
            # Compute relative time since start of recording
            elapsed = time.time() - start_time
            
            # Append this reading to the records
            record_data["records"].append({
                "timestamp": elapsed,
                "positions": positions
            })
            
            # Sleep ~100 ms, giving ~10 samples/sec
            time.sleep(0.1)
    
    except KeyboardInterrupt:
        # User stopped the recording
        pass
    
    # Once recording is done, optionally re-enable torque = 1 or keep it off
    # controller._write("Torque_Enable", 1)
    
    # Disconnect from the servo bus
    controller.disconnect()
    
    # Save the recorded data to a fixed JSON file
    filename = "recording.json"
    with open(filename, 'w') as f:
        json.dump(record_data, f, indent=2)
    
    print(f"Saved recording to {filename}")

if __name__ == "__main__":
    main()
