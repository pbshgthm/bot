import asyncio
import json
import socketio
from typing import Dict, Any, Optional
from core.servos import Servos
import uvicorn

# Create Socket.IO server with ASGI support
socket = socketio.AsyncServer(
    cors_allowed_origins=["http://localhost:5173", "http://pi.local:5173"],
    async_mode="asgi",  
    ping_interval=1,
    ping_timeout=5
)

# Create ASGI application
app = socketio.ASGIApp(
    socketio_server=socket,
    socketio_path="socket.io"
)

# Global variables
servo_controller = None
is_calibrating = False

# Middleware functions
def require_servo_connection(handler):
    async def wrapper(sid, data=None):
        if not servo_controller or not servo_controller.connected:
            return {"status": "error", "message": "Servo controller not connected"}
        return await handler(sid, data)
    return wrapper

def require_calibration_mode(handler):
    async def wrapper(sid, data=None):
        if not servo_controller or not servo_controller.connected or not is_calibrating:
            return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}
        return await handler(sid, data)
    return wrapper

def with_error_handling(handler):
    async def wrapper(sid, data=None):
        try:
            return await handler(sid, data)
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return wrapper

# Initialize servo controller
async def init_servo_controller():
    global servo_controller
    try:
        print("Initializing servo controller...")
        servo_controller = Servos()
        servo_controller.connect()
        asyncio.create_task(broadcast_positions())
        print("Servo controller initialized successfully")
    except Exception as e:
        print(f"Error initializing servo controller: {e}")
        servo_controller = None

# Continuously broadcast servo positions
async def broadcast_positions():
    last_broadcast = {}
    broadcast_interval = 0.01  # 100Hz updates
    
    while True:
        try:
            if servo_controller and servo_controller.connected and not is_calibrating:
                try:
                    positions = servo_controller.get_angles()
                    has_changes = False
                    
                    for key, value in positions.items():
                        last_value = last_broadcast.get(key, 0)
                        if abs(value - last_value) > 0.05:
                            has_changes = True
                            break
                    
                    # Always broadcast for consistent timing
                    await socket.emit('servo_positions', {
                        'positions': positions
                    })
                    last_broadcast = positions.copy()
                except Exception as e:
                    print(f"Error in broadcast_positions: {e}")
            
            await asyncio.sleep(broadcast_interval)
                
        except Exception as e:
            print(f"Outer error in broadcast_positions: {e}")
            await asyncio.sleep(1)

# Socket.IO event handlers
async def on_connect(sid, environ):
    print(f"Client connected: {sid}")
    # Send initial positions if available
    if servo_controller and servo_controller.connected:
        try:
            positions = servo_controller.get_angles()
            await socket.emit('servo_positions', {'positions': positions}, room=sid)
        except Exception as e:
            print(f"Error sending initial positions: {e}")

async def on_disconnect(sid):
    print(f"Client disconnected: {sid}")

@require_servo_connection
@with_error_handling
async def on_update_servo(sid, data):
    servo_id = data["servo_id"]
    position = data["position"]
    servo_controller.set_angle({servo_id: position})
    return {"status": "success", "servo_id": servo_id, "position": position}

@require_servo_connection
@with_error_handling
async def on_get_positions(sid, data=None):
    positions = servo_controller.get_angles()
    return {"status": "success", "positions": positions}

@require_servo_connection
@with_error_handling
async def on_get_torque(sid, data=None):
    enabled = servo_controller.get_torque_enabled()
    return {"status": "success", "enabled": enabled}

@require_servo_connection
@with_error_handling
async def on_set_torque(sid, data):
    enabled = data["enabled"]
    servo_controller.set_torque_enabled(enabled)
    return {"status": "success", "enabled": enabled}

@require_servo_connection
@with_error_handling
async def on_calibration_start(sid, data=None):
    global is_calibrating
    is_calibrating = True
    servo_controller.start_calibration()
    return {"status": "success", "message": "Calibration mode started"}

@require_calibration_mode
@with_error_handling
async def on_calibration_capture(sid, data):
    servo_id = int(data["joint"])
    angle = data["angle"]
    current_pos = servo_controller.get_positions()[servo_id]
    
    # Map angle to calibration point
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
    
    return {
        "status": "success",
        "joint": data["joint"],
        "angle": angle,
        "position": current_pos
    }

@require_calibration_mode
@with_error_handling
async def on_calibration_complete(sid, data=None):
    global is_calibrating
    is_calibrating = False
    servo_controller.end_calibration()
    servo_controller.set_torque_enabled(True)
    return {"status": "success", "message": "Calibration completed successfully"}

@require_calibration_mode
@with_error_handling
async def on_calibration_cancel(sid, data=None):
    global is_calibrating
    is_calibrating = False
    servo_controller.cancel_calibration()
    servo_controller.set_torque_enabled(True)
    positions = servo_controller.get_angles()
    return {"status": "success", "message": "Calibration canceled", "positions": positions}

@require_servo_connection
@with_error_handling
async def on_center_all(sid, data=None):
    angles = {servo_id: 0 for servo_id in servo_controller.get_servos()}
    servo_controller.set_angle(angles)
    return {"status": "success"}

# Register event handlers
socket.on('connect', on_connect)
socket.on('disconnect', on_disconnect)
socket.on('update_servo', on_update_servo)
socket.on('get_positions', on_get_positions)
socket.on('get_torque', on_get_torque)
socket.on('set_torque', on_set_torque)
socket.on('calibration_start', on_calibration_start)
socket.on('calibration_capture', on_calibration_capture)
socket.on('calibration_complete', on_calibration_complete)
socket.on('calibration_cancel', on_calibration_cancel)
socket.on('center_all', on_center_all)

# Initialize on startup
@socket.event
async def connect(sid, environ):
    await init_servo_controller()
    await on_connect(sid, environ)

def main():
    # Run with Uvicorn and auto-reload
    uvicorn.run(
        "server:app", 
        host="0.0.0.0", 
        port=1212, 
        reload=True
    )

if __name__ == '__main__':
    main() 