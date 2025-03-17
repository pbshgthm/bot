#!/usr/bin/env python3
"""
Script to calibrate servos.
"""
import argparse
from servo_controller import ServoController

def main():
    parser = argparse.ArgumentParser(description='Calibrate servos')
    parser.add_argument('--port', '-p', help='Serial port for the servo controller (overrides config)')
    args = parser.parse_args()
    
    try:
        # Initialize controller with optional port override
        controller = ServoController(port=args.port)
        controller.connect()
        print("Starting servo calibration...")
        controller.calibrate()
        controller.disconnect()
    except Exception as e:
        print(f"Error calibrating servos: {e}")

if __name__ == "__main__":
    main() 