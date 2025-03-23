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
from flask_cors import CORS
from flask_sock import Sock
import json
import time
import argparse
import os
import threading
import traceback
import logging
from servo_controller import ServoController
import simple_websocket

# Set up logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('servo-server')

# Create the Flask app with the correct template and static folder paths
app = Flask(__name__, 
            template_folder=os.path.join(os.path.dirname(__file__), 'templates'),
            static_folder=os.path.join(os.path.dirname(__file__), 'static'))

# Enable CORS for all routes
CORS(app)

# Initialize WebSocket
sock = Sock(app)

# Initialize the servo controller with appropriate port
servo_controller = None

# Store last known positions for simulation mode
last_known_positions = {
    'base_yaw': 0, 
    'pitch': 0, 
    'pitch2': 0, 
    'pitch3': 0, 
    'roll': 0, 
    'grip': 0
}

# Store active WebSocket connections
active_ws_connections = set()

# Track last broadcast positions to only send changes
last_broadcast_positions = {}

# Periodically broadcast servo positions to all connected WebSocket clients
def broadcast_positions():
    global last_broadcast_positions
    
    logger.info("Starting WebSocket broadcast thread")
    
    # Initialize last broadcast with current positions
    if servo_controller and servo_controller._is_connected:
        last_broadcast_positions = servo_controller.get_angles().copy()
    else:
        last_broadcast_positions = last_known_positions.copy()
        
    broadcast_interval = 0.25  # Reduce to 4 updates per second (250ms)
    
    while True:
        try:
            if active_ws_connections:
                positions = {}
                has_changes = False
                
                # Get actual positions if connected to hardware
                if servo_controller and servo_controller._is_connected:
                    positions = servo_controller.get_angles()
                    
                    # Ensure all angles are properly clamped for UI display
                    for key, value in positions.items():
                        # Clamp angles to -90 to 90 range for UI only
                        positions[key] = max(-90.0, min(90.0, float(value)))
                        last_known_positions[key] = positions[key]
                else:
                    # Return simulation data
                    positions = last_known_positions
                
                # Check if positions have changed enough to broadcast
                for key, value in positions.items():
                    last_value = last_broadcast_positions.get(key, 0)
                    # Only consider change significant if >0.5 degrees
                    if abs(value - last_value) > 0.5:
                        has_changes = True
                        break
                
                # Only broadcast if there are changes or it's been a while
                if has_changes or not last_broadcast_positions:
                    # Prepare message for broadcast
                    message = json.dumps({
                        'type': 'servo_positions',
                        'positions': positions
                    })
                    
                    # Make a copy to avoid modification during iteration
                    connections = active_ws_connections.copy()
                    
                    # Send to all active connections
                    for ws in connections:
                        try:
                            ws.send(message)
                        except Exception as e:
                            logger.error(f"Error sending to WebSocket: {e}")
                            # Connection may be closed, will be removed on next attempt
                    
                    # Update last broadcast positions
                    last_broadcast_positions = positions.copy()
            
            # Sleep for a short period before next update
            time.sleep(broadcast_interval)
                
        except Exception as e:
            logger.error(f"Error in broadcast thread: {e}")
            logger.error(traceback.format_exc())
            time.sleep(1)  # Longer sleep on error

# WebSocket endpoint
@sock.route('/ws')
def websocket(ws):
    try:
        # Add this connection to active connections
        active_ws_connections.add(ws)
        logger.info(f"New WebSocket connection established. Total connections: {len(active_ws_connections)}")
        
        # Send initial positions immediately upon connection
        try:
            positions = {}
            if servo_controller and servo_controller._is_connected:
                positions = servo_controller.get_angles()
                # Ensure all angles are properly clamped for UI display
                for key, value in positions.items():
                    positions[key] = max(-90.0, min(90.0, float(value)))
            else:
                positions = last_known_positions
                
            # Send initial positions
            ws.send(json.dumps({
                'type': 'servo_positions',
                'positions': positions
            }))
            logger.info("Sent initial positions to new client")
        except Exception as e:
            # Handle case where client disconnected before we could send initial positions
            if "Connection closed:" in str(e):
                logger.info(f"Client disconnected before receiving initial positions: {str(e)}")
                # Remove from active connections if client already disconnected
                try:
                    active_ws_connections.remove(ws)
                except KeyError:
                    pass
                return
            else:
                logger.error(f"Error sending initial positions: {e}")
        
        # Keep connection alive until client disconnects
        while True:
            try:
                message = ws.receive()
                if message is None:
                    # Connection closed by client
                    logger.info("Client closed connection (None received)")
                    break
                    
                logger.info(f"Received WebSocket message: {message}")
                
                data = json.loads(message)
                
                # Handle different message types
                if data.get('type') == 'servo_update':
                    servo_id = data.get('servo_id')
                    position = data.get('position')
                    
                    if servo_id and position is not None:
                        # Process servo update similar to REST API
                        ui_position = max(-90.0, min(90.0, float(position)))
                        last_known_positions[servo_id] = ui_position
                        
                        if servo_controller and servo_controller._is_connected:
                            servo_controller.move({servo_id: position})
                            logger.info(f"WS: Moved {servo_id} to {position}° (UI: {ui_position}°)")
                        else:
                            logger.info(f"WS Simulation: Would move {servo_id} to {position}° (UI: {ui_position}°)")
                            
                elif data.get('type') == 'center_all':
                    # Center all servos
                    for key in last_known_positions:
                        last_known_positions[key] = 0
                        
                    if servo_controller and servo_controller._is_connected:
                        servo_controller.center()
                        logger.info("WS: Centered all servos")
                    else:
                        logger.info("WS Simulation: Would center all servos")
                
                # Respond with acknowledgment
                try:
                    ws.send(json.dumps({
                        'type': 'ack',
                        'status': 'success',
                        'message': f"Processed {data.get('type')}"
                    }))
                except Exception as e:
                    if "Connection closed:" in str(e):
                        logger.info(f"Client disconnected before receiving ack: {str(e)}")
                        break
                    else:
                        raise
                
            except json.JSONDecodeError as e:
                logger.error(f"Received invalid JSON: {message}")
                logger.error(traceback.format_exc())
                # Send error response
                try:
                    ws.send(json.dumps({
                        'type': 'error',
                        'message': 'Invalid JSON format'
                    }))
                except:
                    logger.info("Failed to send error response (client may have disconnected)")
                    break
            except Exception as e:
                # Handle closed connections directly without full traceback for expected disconnects
                if isinstance(e, (simple_websocket.errors.ConnectionClosed)):
                    logger.info(f"Client disconnected: {e}")
                    break
                
                # For other errors, log more details
                logger.error(f"Error processing WebSocket message: {e}")
                logger.error(traceback.format_exc())
                
                # Check if connection is broken
                if "Invalid control opcode" in str(e) or "Connection refused" in str(e) or "Connection closed:" in str(e):
                    logger.info("WebSocket connection appears to be broken, breaking the loop")
                    break
                else:
                    # Try sending error response
                    try:
                        ws.send(json.dumps({
                            'type': 'error',
                            'message': str(e)
                        }))
                    except:
                        # If we can't send, the connection is probably closed
                        logger.info("Failed to send error response, breaking connection loop")
                        break
    
    except simple_websocket.errors.ConnectionClosed as e:
        logger.info(f"Client disconnected during connection setup: {e}")
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
        logger.error(traceback.format_exc())
    finally:
        # Remove from active connections when the connection is closed
        try:
            active_ws_connections.remove(ws)
        except KeyError:
            # May have already been removed
            pass
        logger.info(f"WebSocket connection closed. Remaining connections: {len(active_ws_connections)}")

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
        logger.error(f"Error getting servo positions: {e}")
        logger.error(traceback.format_exc())
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
            logger.info(f"Moved {servo_id} to {position}° (UI: {ui_position}°)")
            
            # Wait a moment for the servo to start moving
            time.sleep(0.05)
            
            # Read back the actual position to confirm
            if servo_id in servo_controller.servo_names:
                actual_angles = servo_controller.get_angles()
                actual_pos = actual_angles.get(servo_id, position)
                # Clamp for UI display
                ui_actual_pos = max(-90.0, min(90.0, actual_pos))
                logger.info(f"Actual position: {actual_pos}° (UI: {ui_actual_pos}°)")
        else:
            # Simulation mode - just log the command
            logger.info(f"Simulation: Would move {servo_id} to {position}° (UI: {ui_position}°)")
        
        # Return success response with updated position (clamped for UI)
        return jsonify({
            'success': True, 
            'servo_id': servo_id, 
            'position': ui_position
        })
    except Exception as e:
        # Handle any errors
        logger.error(f"Error setting servo position: {e}")
        logger.error(traceback.format_exc())
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
            logger.info("Centered all servos")
            
            # Wait a moment for the servos to start moving
            time.sleep(0.1)
            
            # Read back actual positions
            angles = servo_controller.get_angles()
            logger.info(f"Actual positions after centering: {angles}")
        else:
            logger.info("Simulation: Would center all servos")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error centering servos: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

def main():
    parser = argparse.ArgumentParser(description='Servo Control Server')
    parser.add_argument('--port', '-p', help='Serial port for the servo controller (overrides config)')
    parser.add_argument('--host', default='0.0.0.0', help='Host to run the server on')
    parser.add_argument('--port-number', '-n', type=int, default=1212, help='Port number for the server')
    parser.add_argument('--calibrate', '-c', action='store_true', help='Run servo calibration at startup')
    parser.add_argument('--debug', '-d', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    
    # Set log level based on debug flag
    if args.debug:
        logger.setLevel(logging.DEBUG)
        app.logger.setLevel(logging.DEBUG)
    
    logger.info("Starting servo control server")
    
    global servo_controller
    
    # Try to initialize and connect to the servo controller
    try:
        servo_controller = ServoController(port=args.port)
        servo_controller.connect()
        logger.info(f"Connected to servo controller on {servo_controller.port}")
        
        # Run calibration if requested
        if args.calibrate:
            logger.info("Starting servo calibration...")
            servo_controller.calibrate()
    except Exception as e:
        logger.warning(f"Could not connect to servo controller: {e}")
        logger.info("Running in simulation mode")
        # Still create controller object for accessing servo names
        try:
            servo_controller = ServoController(port=args.port)
            servo_controller._is_connected = False
        except Exception as e:
            logger.error(f"Failed to create ServoController: {e}")
            servo_controller = None
    
    # Start the broadcast thread
    broadcast_thread = threading.Thread(target=broadcast_positions, daemon=True)
    broadcast_thread.start()
    logger.info("Started broadcast thread")
    
    try:
        logger.info(f"Starting server on http://{args.host}:{args.port_number}")
        # Configure for better WebSocket handling in development
        # Disable reloader to prevent broadcast thread duplication
        app.run(host=args.host, port=args.port_number, debug=args.debug, 
                threaded=True, use_reloader=False)
    finally:
        # Clean up hardware resources when the app exits
        if servo_controller and servo_controller._is_connected:
            try:
                servo_controller.disconnect()
                logger.info("Disconnected from servo controller")
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")

if __name__ == '__main__':
    main() 