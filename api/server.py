from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
import asyncio
import uvicorn
from core.servos import Servos
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    global servo_controller
    try:
        servo_controller = Servos()
        servo_controller.connect()
        asyncio.create_task(broadcast_positions())
    except Exception:
        pass
    yield

app = FastAPI(lifespan=lifespan)
servo_controller = None
is_calibrating = False  # Add global flag to track calibration state

class ConnectionManager:
    def __init__(self):
        self.active_connections = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                disconnected.add(connection)
        
        for ws in disconnected:
            self.active_connections.remove(ws)

manager = ConnectionManager()

async def broadcast_positions():
    last_broadcast = {}
    broadcast_interval = 0.25
    
    while True:
        try:
            if manager.active_connections and servo_controller and servo_controller.connected and not is_calibrating:  # Add check for calibration state
                positions = servo_controller.get_angles()
                has_changes = False
                
                for key, value in positions.items():
                    last_value = last_broadcast.get(key, 0)
                    if abs(value - last_value) > 0.5:
                        has_changes = True
                        break
                
                if has_changes or not last_broadcast:
                    message = json.dumps({
                        'type': 'servo_positions',
                        'positions': positions,
                        'broadcast': True
                    })
                    await manager.broadcast(message)
                    last_broadcast = positions.copy()
            
            await asyncio.sleep(broadcast_interval)
                
        except Exception:
            await asyncio.sleep(1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global is_calibrating  # Move global declaration to the beginning of the function
    await manager.connect(websocket)
    
    try:
        if servo_controller and servo_controller.connected:
            positions = servo_controller.get_angles()
            await websocket.send_text(json.dumps({
                'type': 'servo_positions',
                'positions': positions
            }))
            print(f"Sent initial positions to client: {positions}")
        
        while True:
            message = await websocket.receive_text()
            print(f"Received WebSocket message: {message}")
            data = json.loads(message)
            request_id = data.get('requestId')
            
            if data.get('type') == 'servo_update':
                servo_id = data.get('servo_id')
                position = data.get('position')
                
                print(f"Processing servo_update: servo_id={servo_id}, position={position}")
                
                if servo_id is not None and position is not None:
                    if servo_controller and servo_controller.connected:
                        # Convert the servo_id to int to ensure compatibility
                        try:
                            servo_id = int(servo_id)
                            print(f"Setting servo {servo_id} to position {position}°")
                            servo_controller.set_angle({servo_id: position})
                            print(f"Successfully set servo {servo_id} to position {position}°")
                        except Exception as e:
                            print(f"Error setting servo position: {e}")
                            await websocket.send_text(json.dumps({
                                'type': 'error',
                                'requestId': request_id,
                                'message': f"Error setting position: {str(e)}"
                            }))
                            continue
                    else:
                        print("Cannot set position - servo controller not connected")
                    
                    await websocket.send_text(json.dumps({
                        'type': 'ack',
                        'requestId': request_id,
                        'status': 'success',
                        'servo_id': servo_id,
                        'position': position
                    }))
                    print(f"Sent ack message for servo_update")
                else:
                    print(f"Invalid servo_update: Missing servo_id or position")
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'requestId': request_id,
                        'message': "Missing servo_id or position"
                    }))
            
            elif data.get('type') == 'center_all':
                if servo_controller and servo_controller.connected:
                    angles = {servo_id: 0 for servo_id in servo_controller.get_servos()}
                    servo_controller.set_angle(angles)
                
                await websocket.send_text(json.dumps({
                    'type': 'ack',
                    'requestId': request_id,
                    'status': 'success'
                }))
            
            elif data.get('type') == 'start_calibration':
                is_calibrating = True  # Set calibration flag
                print(f"Starting calibration mode, is_calibrating={is_calibrating}")
                if servo_controller and servo_controller.connected:
                    try:
                        servo_controller.start_calibration()
                        
                        # Send only an acknowledgment without positions
                        await websocket.send_text(json.dumps({
                            'type': 'calibration_started',
                            'requestId': request_id,
                            'message': 'Calibration mode started'
                        }))
                        print(f"Sent calibration_started acknowledgment")
                    except Exception as e:
                        print(f"Error starting calibration: {e}")
                        await websocket.send_text(json.dumps({
                            'type': 'error',
                            'message': f'Failed to start calibration: {str(e)}',
                            'requestId': request_id
                        }))
                else:
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'message': 'Servo controller is not connected',
                        'requestId': request_id
                    }))
            
            elif data.get('type') == 'set_calibration_step':
                # New message type to allow UI to control which step is active
                if servo_controller and servo_controller.connected:
                    joint_name = data.get('joint')
                    angle = data.get('angle')
                    step_number = int(data.get('step_number', 1))
                    total_steps = int(data.get('total_steps', 1))
                    
                    print(f"Setting calibration step: joint={joint_name}, angle={angle}, step={step_number}/{total_steps}")
                    
                    try:
                        # Only send acknowledgment back
                        await websocket.send_text(json.dumps({
                            'type': 'calibration_step_ack',
                            'joint': joint_name,
                            'angle': angle,
                            'current_step': step_number,
                            'total_steps': total_steps,
                            'requestId': request_id
                        }))
                        print(f"Sent calibration_step_ack for joint={joint_name}, angle={angle}")
                    except Exception as e:
                        print(f"Error setting calibration step: {e}")
                        await websocket.send_text(json.dumps({
                            'type': 'error',
                            'message': f'Failed to set calibration step: {str(e)}',
                            'requestId': request_id
                        }))
                else:
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'message': 'Servo controller is not connected',
                        'requestId': request_id
                    }))
            
            elif data.get('type') == 'capture_position':
                if servo_controller and servo_controller.connected:
                    joint_name = data.get('joint')
                    angle = data.get('angle')
                    step_number = int(data.get('step_number', 1))
                    
                    print(f"Capturing position for joint={joint_name}, angle={angle}, step={step_number}")
                    
                    # Find the ID of this servo
                    servo_id = int(joint_name)  # In our case, joint_name is the numeric ID as a string
                    current_pos = servo_controller.get_positions()[servo_id]
                    
                    calibration_point = "zero"
                    if angle == 90:
                        calibration_point = "max"
                    elif angle == -90:
                        calibration_point = "min"
                        
                    servo_controller.set_calibration_point(
                        servo_id,
                        calibration_point,
                        current_pos
                    )
                    
                    # Send ack with the captured position
                    await websocket.send_text(json.dumps({
                        'type': 'position_captured',
                        'joint': joint_name,
                        'angle': angle,
                        'position': current_pos,
                        'requestId': request_id
                    }))
                    
                    # Let the UI decide the next step instead of the server
                    # The UI will send a set_calibration_step message for the next step
            
            elif data.get('type') == 'end_calibration':
                # New message type to explicitly end calibration
                if is_calibrating and servo_controller and servo_controller.connected:
                    is_calibrating = False
                    print(f"Ending calibration mode, is_calibrating={is_calibrating}")
                    servo_controller.end_calibration()
                    servo_controller.enable_torque()
                    
                    # Only send acknowledgment
                    await websocket.send_text(json.dumps({
                        'type': 'calibration_completed',
                        'requestId': request_id,
                        'message': 'Calibration completed successfully'
                    }))
                    print(f"Sent calibration_completed acknowledgment")
            
            elif data.get('type') == 'get_positions':
                if servo_controller and servo_controller.connected:
                    positions = servo_controller.get_angles()
                    await websocket.send_text(json.dumps({
                        'type': 'ack',
                        'requestId': request_id,
                        'status': 'success',
                        'positions': positions
                    }))
                    
    except WebSocketDisconnect:
        # Reset calibration flag if client disconnects during calibration
        if is_calibrating:
            is_calibrating = False
        manager.disconnect(websocket)
    finally:
        manager.disconnect(websocket)

def main():
    uvicorn.run(app, host="0.0.0.0", port=1212)

if __name__ == '__main__':
    main() 