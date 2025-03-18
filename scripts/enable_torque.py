#!/usr/bin/env python3
"""
Script to enable torque on all servos.
"""
import argparse
from servo_controller import ServoController
import time

def main():
    parser = argparse.ArgumentParser(description='Enable torque on all servos')
    parser.add_argument('--port', '-p', help='Serial port for the servo controller (overrides config)')
    args = parser.parse_args()
    
    try:
        # Initialize controller with optional port override
        controller = ServoController(port=args.port)
        controller.connect()
        print("Enabling torque on all servos...")
        controller._write("Torque_Enable", 1)
        print("Torque enabled on all servos")
        while True:
            time.sleep(1)
        controller.disconnect()
    except Exception as e:
        print(f"Error enabling torque on servos: {e}")

if __name__ == "__main__":
    main() 