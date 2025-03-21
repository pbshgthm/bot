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

# Store last known positions for simulation mode
last_known_positions = {
    'base_yaw': 0, 
    'pitch': 0, 
    'pitch2': 0, 
    'pitch3': 0, 
    'pitch4': 0, 
    'pitch5': 0
}

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
            
            # Ensure all angles are properly clamped for UI display
            for key, value in angles.items():
                # Clamp angles to -90 to 90 range for UI only
                angles[key] = max(-90.0, min(90.0, float(value)))
                last_known_positions[key] = angles[key]
                
            return jsonify(angles)
        else:
            # Return simulation data (last known positions)
            return jsonify(last_known_positions)
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
    
    # Clamp to valid UI range
    ui_position = max(-90.0, min(90.0, position))
    
    try:
        # Update the last known position
        last_known_positions[servo_id] = ui_position
        
        if servo_controller and servo_controller._is_connected:
            # Pass the exact position to the servo controller
            # It will handle scaling beyond 90/-90 if needed internally
            servo_controller.move({servo_id: position})
            print(f"Moved {servo_id} to {position}° (UI: {ui_position}°)")
            
            # Wait a moment for the servo to start moving
            time.sleep(0.05)
            
            # Read back the actual position to confirm
            if servo_id in servo_controller.servo_names:
                actual_angles = servo_controller.get_angles()
                actual_pos = actual_angles.get(servo_id, position)
                # Clamp for UI display
                ui_actual_pos = max(-90.0, min(90.0, actual_pos))
                print(f"Actual position: {actual_pos}° (UI: {ui_actual_pos}°)")
        else:
            # Simulation mode - just log the command
            print(f"Simulation: Would move {servo_id} to {position}° (UI: {ui_position}°)")
        
        # Return success response with updated position (clamped for UI)
        return jsonify({
            'success': True, 
            'servo_id': servo_id, 
            'position': ui_position
        })
    except Exception as e:
        # Handle any errors
        print(f"Error setting servo position: {e}")
        return jsonify({'error': str(e)}), 500

# API endpoint to center all servos
@app.route('/api/servo/center', methods=['POST'])
def center_servos():
    try:
        # Reset all last known positions to 0
        for key in last_known_positions:
            last_known_positions[key] = 0
            
        if servo_controller and servo_controller._is_connected:
            servo_controller.center()
            print("Centered all servos")
            
            # Wait a moment for the servos to start moving
            time.sleep(0.1)
            
            # Read back actual positions
            angles = servo_controller.get_angles()
            print(f"Actual positions after centering: {angles}")
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
    parser.add_argument('--calibrate', '-c', action='store_true', help='Run servo calibration at startup')
    args = parser.parse_args()
    
    global servo_controller
    
    # Try to initialize and connect to the servo controller
    try:
        servo_controller = ServoController(port=args.port)
        servo_controller.connect()
        print(f"Connected to servo controller on {servo_controller.port}")
        
        # Run calibration if requested
        if args.calibrate:
            print("Starting servo calibration...")
            servo_controller.calibrate()
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
        print(f"Starting server on http://{args.host}:{args.port_number}")
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