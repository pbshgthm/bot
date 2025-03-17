from flask import Flask, render_template, request, jsonify
import time
from servo_controller import ServoController

app = Flask(__name__)

# Define the servo IDs
SERVOS = {
    "base_yaw": 1,  # ID of the base yaw servo
    "pitch": 2,     # ID of the first pitch servo
    "pitch2": 3,    # ID of the second pitch servo
    "pitch3": 4     # ID of the third pitch servo
}

# Initialize the servo controller with appropriate port
# Replace with your actual serial port
SERVO_PORT = "/dev/tty.usbmodem58FA0829321"
# Try to connect to the servo controller
try:
    servo_controller = ServoController(SERVO_PORT, SERVOS)
    servo_controller.connect()
    print(f"Connected to servo controller on {SERVO_PORT}")
except Exception as e:
    print(f"Warning: Could not connect to servo controller: {e}")
    print("Running in simulation mode")
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
            return jsonify({"base_yaw": 0, "pitch": 0, "pitch2": 0, "pitch3": 0})
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

if __name__ == '__main__':
    try:
        app.run(debug=True, host='0.0.0.0', port=1212)
    finally:
        # Clean up hardware resources when the app exits
        if servo_controller and servo_controller._is_connected:
            try:
                servo_controller.disconnect()
                print("Disconnected from servo controller")
            except Exception as e:
                print(f"Error disconnecting: {e}") 