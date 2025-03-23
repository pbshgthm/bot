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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import time
import argparse
import os
import threading
import traceback
import logging
import uvicorn
import asyncio
from servo_controller import ServoController
import datetime

# Set up logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('servo-server')

# Create the FastAPI app
app = FastAPI()

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

# Flag to indicate if calibration is in progress
calibrating = False

# Define servo IDs for simulation mode if they're not available
SERVO_IDS = {
    'base_yaw': 1, 
    'pitch': 2, 
    'pitch2': 3, 
    'pitch3': 4, 
    'roll': 5, 
    'grip': 6
}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"New WebSocket connection established. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket connection closed. Remaining connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            
    async def broadcast(self, message: str):
        disconnected_websockets = set()
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Error broadcasting: {e}")
                disconnected_websockets.add(connection)
        
        # Remove disconnected websockets
        for ws in disconnected_websockets:
            self.active_connections.remove(ws)

manager = ConnectionManager()

# Get the current event loop for broadcasting
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

# Periodically broadcast servo positions to all connected WebSocket clients
def broadcast_positions():
    global last_broadcast_positions, calibrating
    
    logger.info("Starting WebSocket broadcast thread")
    
    # Initialize last broadcast with current positions
    if servo_controller and servo_controller._is_connected:
        last_broadcast_positions = servo_controller.get_angles().copy()
    else:
        last_broadcast_positions = last_known_positions.copy()
        
    broadcast_interval = 0.25  # Reduce to 4 updates per second (250ms)
    
    while True:
        try:
            # Skip updates if calibration is in progress
            if calibrating:
                time.sleep(broadcast_interval)
                continue
                
            if manager.active_connections:
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
                    # Prepare message for broadcast - explicitly set type to broadcast to distinguish from responses
                    message = json.dumps({
                        'type': 'servo_positions',
                        'positions': positions,
                        'broadcast': True  # Indicate this is a broadcast, not a response
                    })
                    
                    # Use asyncio to broadcast the message
                    asyncio.run_coroutine_threadsafe(manager.broadcast(message), loop)
                    
                    # Update last broadcast positions
                    last_broadcast_positions = positions.copy()
            
            # Sleep for a short period before next update
            time.sleep(broadcast_interval)
                
        except Exception as e:
            logger.error(f"Error in broadcast thread: {e}")
            logger.error(traceback.format_exc())
            time.sleep(1)  # Longer sleep on error

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(os.path.dirname(__file__), 'templates', 'index.html'))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global calibrating
    await manager.connect(websocket)
    
    try:
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
            await websocket.send_text(json.dumps({
                'type': 'servo_positions',
                'positions': positions
            }))
            logger.info("Sent initial positions to new client")
        except Exception as e:
            logger.error(f"Error sending initial positions: {e}")
        
        # Keep connection alive until client disconnects
        while True:
            # Receive message from client
            message = await websocket.receive_text()
            logger.info(f"Received WebSocket message: {message}")
            
            # Process message
            try:
                data = json.loads(message)
                request_id = data.get('requestId')
                
                # Handle different message types
                if data.get('type') == 'servo_update':
                    servo_id = data.get('servo_id')
                    position = data.get('position')
                    
                    if servo_id and position is not None:
                        # Process servo update
                        ui_position = max(-90.0, min(90.0, float(position)))
                        last_known_positions[servo_id] = ui_position
                        
                        if servo_controller and servo_controller._is_connected:
                            servo_controller.move({servo_id: position})
                            logger.info(f"WS: Moved {servo_id} to {position}° (UI: {ui_position}°)")
                            
                            # Read back the actual position to confirm
                            actual_pos = None
                            if servo_id in servo_controller.servos:
                                actual_angles = servo_controller.get_angles()
                                actual_pos = actual_angles.get(servo_id, position)
                        else:
                            logger.info(f"WS Simulation: Would move {servo_id} to {position}° (UI: {ui_position}°)")
                            
                        # Send acknowledgment
                        await websocket.send_text(json.dumps({
                            'type': 'ack',
                            'requestId': request_id,
                            'status': 'success',
                            'servo_id': servo_id,
                            'position': ui_position
                        }))
                
                elif data.get('type') == 'center_all':
                    # Center all servos
                    for key in last_known_positions:
                        last_known_positions[key] = 0
                        
                    if servo_controller and servo_controller._is_connected:
                        servo_controller.center()
                        logger.info("WS: Centered all servos")
                    else:
                        logger.info("WS Simulation: Would center all servos")
                        
                    # Send acknowledgment
                    await websocket.send_text(json.dumps({
                        'type': 'ack',
                        'requestId': request_id,
                        'status': 'success'
                    }))
                
                elif data.get('type') == 'start_calibration':
                    # Enter calibration mode
                    calibrating = True
                    logger.info("Entering calibration mode")
                    
                    if servo_controller and servo_controller._is_connected:
                        # Disable torque on all servos
                        servo_controller._write("Torque_Enable", 0)
                        logger.info("Disabled torque on all servos for calibration")
                        
                        # Send acknowledgment that torque is released
                        await websocket.send_text(json.dumps({
                            'type': 'ack', 
                            'message': 'torque_released'
                        }))
                        
                        # Send first calibration step - waiting for UI to send capture commands
                        try:
                            # Initialize calibration data structure
                            calibration_data = {}
                            
                            # Get all servo IDs and names
                            servo_items = list(servo_controller.servos.items())
                            
                            # Send initial calibration step
                            if servo_items:
                                first_joint, first_id = servo_items[0]
                                await websocket.send_text(json.dumps({
                                    'type': 'calibration_step',
                                    'joint': first_joint,
                                    'angle': 0,
                                    'total_steps': len(servo_items) * 3,
                                    'current_step': 1
                                }))
                        except Exception as e:
                            logger.error(f"Error starting calibration: {e}")
                            logger.error(traceback.format_exc())
                            await websocket.send_text(json.dumps({
                                'type': 'error',
                                'message': f'Calibration error: {str(e)}'
                            }))
                            calibrating = False
                    else:
                        # Simulation mode
                        logger.info("WS Simulation: Would start calibration")
                        
                        # Send acknowledgment
                        await websocket.send_text(json.dumps({
                            'type': 'ack', 
                            'message': 'torque_released'
                        }))
                        
                        # Send first calibration step
                        servo_names = ['base_yaw', 'pitch', 'pitch2', 'pitch3', 'roll', 'grip']
                        angles = [0, 90, -90]  # Define the angle sequence explicitly
                        first_step = 1
                        
                        logger.info(f"Starting calibration simulation with {len(servo_names)} joints, {len(angles)} angles per joint, total {len(servo_names) * len(angles)} steps")
                        logger.info(f"First step: {first_step}/{len(servo_names) * len(angles)} - Joint: {servo_names[0]}, Angle: {angles[0]}°")
                        
                        await websocket.send_text(json.dumps({
                            'type': 'calibration_step',
                            'joint': servo_names[0],
                            'angle': angles[0],
                            'total_steps': len(servo_names) * len(angles),
                            'current_step': first_step
                        }))
                
                elif data.get('type') == 'capture_position':
                    # Handle position capture for calibration
                    if calibrating:
                        joint_name = data.get('joint')
                        angle = data.get('angle')
                        step_number = data.get('step_number')
                        
                        logger.info(f"Capturing position for {joint_name} at {angle}° (step {step_number}) - Raw data: {data}")
                        
                        # Ensure step_number is an integer, default to 1 if missing
                        if step_number is None:
                            step_number = 1
                            logger.warning(f"Missing step_number in capture_position request, defaulting to {step_number}")
                        else:
                            try:
                                step_number = int(step_number)
                            except (ValueError, TypeError):
                                logger.warning(f"Invalid step_number format: {step_number}, defaulting to 1")
                                step_number = 1
                        
                        logger.info(f"Processing capture for step {step_number}: {joint_name} at {angle}°")
                        
                        if servo_controller and servo_controller._is_connected:
                            # Get the current position from the servo
                            servo_id = servo_controller.servos.get(joint_name)
                            if servo_id:
                                position = servo_controller._read("Present_Position", [servo_id])[0]
                                
                                # Store calibration point
                                if not hasattr(servo_controller, 'calibration_progress'):
                                    servo_controller.calibration_progress = {}
                                
                                if str(servo_id) not in servo_controller.calibration_progress:
                                    servo_controller.calibration_progress[str(servo_id)] = {}
                                    
                                # Save the position according to angle
                                if angle == 0:
                                    servo_controller.calibration_progress[str(servo_id)]["zero"] = int(position)
                                elif angle == 90:
                                    servo_controller.calibration_progress[str(servo_id)]["max"] = int(position)
                                elif angle == -90:
                                    servo_controller.calibration_progress[str(servo_id)]["min"] = int(position)
                                
                                # Notify UI of successful capture
                                await websocket.send_text(json.dumps({
                                    'type': 'position_captured',
                                    'joint': joint_name,
                                    'angle': angle,
                                    'position': int(position)
                                }))
                                
                                # Calculate next step - regardless of what the client sent, 
                                # we know what the next step should be
                                servo_items = list(servo_controller.servos.items())
                                total_steps = len(servo_items) * 3
                                
                                # Move to next step - explicitly calculate based on current joint/angle
                                current_joint_index = 0
                                current_angle_index = 0
                                angles = [0, 90, -90]  # Define the angle sequence
                                
                                # Find the current joint index in our list
                                for i, (joint, _) in enumerate(servo_items):
                                    if joint == joint_name:
                                        current_joint_index = i
                                        break
                                
                                # Find the current angle index
                                for i, a in enumerate(angles):
                                    if a == angle:
                                        current_angle_index = i
                                        break
                                
                                # Calculate the next angle index and joint index
                                next_angle_index = (current_angle_index + 1) % len(angles)
                                next_joint_index = current_joint_index
                                
                                # If we've gone through all angles for this joint, move to the next joint
                                if next_angle_index == 0:
                                    next_joint_index = current_joint_index + 1
                                
                                # Calculate the absolute step number
                                next_step = next_joint_index * len(angles) + next_angle_index + 1
                                
                                logger.info(f"Calculated next step: {next_step}/{total_steps} - " +
                                           f"joint_index={next_joint_index}, angle_index={next_angle_index}")
                                
                                if next_step <= total_steps:
                                    if next_joint_index < len(servo_items):
                                        next_joint, next_id = servo_items[next_joint_index]
                                        next_angle = angles[next_angle_index]
                                        
                                        logger.info(f"Sending next step: {next_step}/{total_steps} - Joint: {next_joint}, Angle: {next_angle}°")
                                        
                                        # Send next calibration step
                                        await websocket.send_text(json.dumps({
                                            'type': 'calibration_step',
                                            'joint': next_joint,
                                            'angle': next_angle,
                                            'total_steps': total_steps,
                                            'current_step': next_step
                                        }))
                                else:
                                    # All steps completed
                                    # Save calibration data
                                    servo_controller.calibration = servo_controller.calibration_progress
                                    servo_controller.calibration["timestamp"] = datetime.datetime.now().isoformat()
                                    
                                    try:
                                        with open(servo_controller.calibration_file, 'w') as f:
                                            json.dump(servo_controller.calibration, f, indent=2)
                                        logger.info(f"Saved calibration to {servo_controller.calibration_file}")
                                    except Exception as e:
                                        logger.error(f"Error saving calibration: {e}")
                                    
                                    # Re-enable torque
                                    servo_controller._write("Torque_Enable", 1)
                                    
                                    # Send calibration complete
                                    await websocket.send_text(json.dumps({
                                        'type': 'calibration_complete',
                                        'positions': servo_controller.get_angles()
                                    }))
                                    
                                    # Reset calibration flag
                                    calibrating = False
                                    logger.info("Calibration completed successfully!")
                        else:
                            # Simulation mode
                            # Log for debugging
                            logger.info(f"Simulating position capture for {joint_name} at {angle}° (step {step_number})")
                            
                            # Send success message
                            await websocket.send_text(json.dumps({
                                'type': 'position_captured',
                                'joint': joint_name,
                                'angle': angle,
                                'position': 2048  # Simulated center position
                            }))
                            
                            # Calculate next step - same logic as above
                            servo_items = list(SERVO_IDS.items())
                            total_steps = len(servo_items) * 3
                            
                            # Move to next step - explicitly calculate based on current joint/angle
                            current_joint_index = 0
                            current_angle_index = 0
                            angles = [0, 90, -90]  # Define the angle sequence
                            
                            # Find the current joint index in our list
                            for i, (joint, _) in enumerate(servo_items):
                                if joint == joint_name:
                                    current_joint_index = i
                                    break
                            
                            # Find the current angle index
                            for i, a in enumerate(angles):
                                if a == angle:
                                    current_angle_index = i
                                    break
                            
                            # Calculate the next angle index and joint index
                            next_angle_index = (current_angle_index + 1) % len(angles)
                            next_joint_index = current_joint_index
                            
                            # If we've gone through all angles for this joint, move to the next joint
                            if next_angle_index == 0:
                                next_joint_index = current_joint_index + 1
                            
                            # Calculate the absolute step number
                            next_step = next_joint_index * len(angles) + next_angle_index + 1
                            
                            logger.info(f"Simulation - Calculated next step: {next_step}/{total_steps} - " +
                                       f"joint_index={next_joint_index}, angle_index={next_angle_index}")
                            
                            if next_step <= total_steps:
                                if next_joint_index < len(servo_items):
                                    next_joint, next_id = servo_items[next_joint_index]
                                    next_angle = angles[next_angle_index]
                                    
                                    logger.info(f"Simulation - Sending next step: {next_step}/{total_steps} - Joint: {next_joint}, Angle: {next_angle}°")
                                    
                                    # Send next calibration step
                                    await websocket.send_text(json.dumps({
                                        'type': 'calibration_step',
                                        'joint': next_joint,
                                        'angle': next_angle,
                                        'total_steps': total_steps,
                                        'current_step': next_step
                                    }))
                            else:
                                # All steps completed - send complete message
                                await websocket.send_text(json.dumps({
                                    'type': 'calibration_complete',
                                    'positions': last_known_positions
                                }))
                                
                                # Reset calibration flag
                                calibrating = False
                                logger.info("Simulation: Calibration completed successfully!")
                    else:
                        # Not in calibration mode
                        await websocket.send_text(json.dumps({
                            'type': 'error',
                            'message': 'Not in calibration mode'
                        }))
                
                elif data.get('type') == 'get_positions':
                    # Get current positions
                    positions = {}
                    if servo_controller and servo_controller._is_connected:
                        positions = servo_controller.get_angles()
                        # Ensure all angles are properly clamped for UI display
                        for key, value in positions.items():
                            positions[key] = max(-90.0, min(90.0, float(value)))
                            last_known_positions[key] = positions[key]
                    else:
                        positions = last_known_positions
                        
                    # Send response with positions
                    await websocket.send_text(json.dumps({
                        'type': 'ack',
                        'requestId': request_id,
                        'status': 'success',
                        'positions': positions
                    }))
                    
                else:
                    # Unknown message type
                    logger.warning(f"Unknown WebSocket message type: {data.get('type')}")
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'requestId': request_id,
                        'message': f"Unknown message type: {data.get('type')}"
                    }))
                    
            except json.JSONDecodeError as e:
                logger.error(f"Received invalid JSON: {message}")
                logger.error(traceback.format_exc())
                # Send error response
                await websocket.send_text(json.dumps({
                    'type': 'error',
                    'message': 'Invalid JSON format'
                }))
                
            except Exception as e:
                logger.error(f"Error processing WebSocket message: {e}")
                logger.error(traceback.format_exc())
                
                # Try sending error response with requestId if available
                try:
                    error_response = {
                        'type': 'error',
                        'message': str(e)
                    }
                    if request_id:
                        error_response['requestId'] = request_id
                    await websocket.send_text(json.dumps(error_response))
                except:
                    logger.error("Failed to send error response")
                    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        logger.error(traceback.format_exc())
    finally:
        manager.disconnect(websocket)

def main():
    logger.info("Starting servo control server")
    
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
        # Start the server with Uvicorn
        uvicorn.run(app, host=args.host, port=args.port_number, log_level="info")
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