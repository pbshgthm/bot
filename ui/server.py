#!/usr/bin/env python3
"""
Main server for the servo control system.
Controls six servos (1-6) for a robotic arm:
- Servo 1: Base rotation (yaw)
- Servo 2: Segment 1 (pitch)
- Servo 3: Segment 2 (pitch)
- Servo 4: Segment 3 (pitch)
- Servo 5: Roll
- Servo 6: End effector (pitch)
"""
from flask import Flask, render_template, request, jsonify
import time
import argparse
import os
from servo_controller import ServoController

# Create the Flask app with the correct template and static folder paths
app = Flask(__name__, 
            template_folder=os.path.join(os.path.dirname(__file__), 'templates'),
            static_folder=os.path.join(os.path.dirname(__file__), 'static'))

# Initialize the servo controller with appropriate port
servo_controller = None

@app.route('/')
def index():
    return render_template('index.html')

# API endpoint to get current servo positions
@app.route('/api/servo/positions', methods=['GET'])
def get_servo_positions():
    try:
        if servo_controller and servo_controller._is_connected:
            # Get actual positions from the servos
            angles = servo_controller.get_angles()
            return jsonify(angles)
        else:
            # Return simulation data
            return jsonify({name: 0 for name in (servo_controller.servo_names if servo_controller else [])})
    except Exception as e:
        print(f"Error getting servo positions: {e}")
        return jsonify({"error": str(e)}), 500

# API endpoint to update a servo position
@app.route('/api/servo/update', methods=['POST'])
def update_servo():
    data = request.json
    if not data or 'servo_id' not in data or 'position' not in data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    servo_id = data['servo_id']
    position = float(data['position'])  # Convert to float for precise positioning
    
    # Validate position is within range
    if position < -90 or position > 90:
        return jsonify({'error': 'Position out of range (-90 to 90)'}), 400
    
    try:
        if servo_controller and servo_controller._is_connected:
            # Update the actual servo position
            servo_controller.move({servo_id: position})
            print(f"Moved {servo_id} to {position}°")
        else:
            # Simulation mode - just log the command
            print(f"Simulation: Would move {servo_id} to {position}°")
        
        # Return success response
        return jsonify({
            'success': True, 
            'servo_id': servo_id, 
            'position': position
        })
    except Exception as e:
        # Handle any errors
        print(f"Error setting servo position: {e}")
        return jsonify({'error': str(e)}), 500

# API endpoint to center all servos
@app.route('/api/servo/center', methods=['POST'])
def center_servos():
    try:
        if servo_controller and servo_controller._is_connected:
            servo_controller.center()
            print("Centered all servos")
        else:
            print("Simulation: Would center all servos")
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error centering servos: {e}")
        return jsonify({'error': str(e)}), 500

def main():
    parser = argparse.ArgumentParser(description='Servo Control Server')
    parser.add_argument('--port', '-p', help='Serial port for the servo controller (overrides config)')
    parser.add_argument('--host', default='0.0.0.0', help='Host to run the server on')
    parser.add_argument('--port-number', '-n', type=int, default=1212, help='Port number for the server')
    args = parser.parse_args()
    
    global servo_controller
    
    # Try to initialize and connect to the servo controller
    try:
        servo_controller = ServoController(port=args.port)
        servo_controller.connect()
        print(f"Connected to servo controller on {servo_controller.port}")
    except Exception as e:
        print(f"Warning: Could not connect to servo controller: {e}")
        print("Running in simulation mode")
        # Still create controller object for accessing servo names
        try:
            servo_controller = ServoController(port=args.port)
            servo_controller._is_connected = False
        except Exception:
            servo_controller = None
    
    try:
        app.run(host=args.host, port=args.port_number)
    finally:
        # Clean up hardware resources when the app exits
        if servo_controller and servo_controller._is_connected:
            try:
                servo_controller.disconnect()
                print("Disconnected from servo controller")
            except Exception as e:
                print(f"Error disconnecting: {e}")

if __name__ == '__main__':
    main() 