import asyncio
import json
import socketio
from aiohttp import web
from core.servos import Servos
from typing import Dict, Any, Optional

# Create Socket.IO server
sio = socketio.AsyncServer(
    cors_allowed_origins=["http://localhost:5173"],
    async_mode="aiohttp",
    ping_interval=1,
    ping_timeout=5
)

# Create aiohttp web application
app = web.Application()
sio.attach(app)

# Global variables
servo_controller = None
is_calibrating = False

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
                    await sio.emit('servo_positions', {
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
            await sio.emit('servo_positions', {'positions': positions}, room=sid)
        except Exception as e:
            print(f"Error sending initial positions: {e}")

async def on_disconnect(sid):
    print(f"Client disconnected: {sid}")

async def on_update_servo(sid, data):
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    try:
        servo_id = data["servo_id"]
        position = data["position"]
        servo_controller.set_angle({servo_id: position})
        return {"status": "success", "servo_id": servo_id, "position": position}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def on_get_positions(sid, data=None):
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    positions = servo_controller.get_angles()
    return {"status": "success", "positions": positions}

async def on_get_torque(sid, data=None):
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    enabled = servo_controller.get_torque_enabled()
    return {"status": "success", "enabled": enabled}

async def on_set_torque(sid, data):
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    enabled = data["enabled"]
    servo_controller.set_torque_enabled(enabled)
    return {"status": "success", "enabled": enabled}

async def on_calibration_start(sid, data=None):
    global is_calibrating
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    try:
        is_calibrating = True
        servo_controller.start_calibration()
        return {"status": "success", "message": "Calibration mode started"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def on_calibration_capture(sid, data):
    if not servo_controller or not servo_controller.connected or not is_calibrating:
        return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}
    
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

async def on_calibration_complete(sid, data=None):
    global is_calibrating
    if not servo_controller or not servo_controller.connected or not is_calibrating:
        return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}
    
    is_calibrating = False
    servo_controller.end_calibration()
    servo_controller.set_torque_enabled(True)
    return {"status": "success", "message": "Calibration completed successfully"}

async def on_calibration_cancel(sid, data=None):
    global is_calibrating
    if not servo_controller or not servo_controller.connected or not is_calibrating:
        return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}
    
    is_calibrating = False
    servo_controller.cancel_calibration()
    servo_controller.set_torque_enabled(True)
    positions = servo_controller.get_angles()
    return {"status": "success", "message": "Calibration canceled", "positions": positions}

async def on_center_all(sid, data=None):
    if not servo_controller or not servo_controller.connected:
        return {"status": "error", "message": "Servo controller not connected"}
    
    angles = {servo_id: 0 for servo_id in servo_controller.get_servos()}
    servo_controller.set_angle(angles)
    return {"status": "success"}

# Register event handlers
sio.on('connect', on_connect)
sio.on('disconnect', on_disconnect)
sio.on('update_servo', on_update_servo)
sio.on('get_positions', on_get_positions)
sio.on('get_torque', on_get_torque)
sio.on('set_torque', on_set_torque)
sio.on('calibration_start', on_calibration_start)
sio.on('calibration_capture', on_calibration_capture)
sio.on('calibration_complete', on_calibration_complete)
sio.on('calibration_cancel', on_calibration_cancel)
sio.on('center_all', on_center_all)

async def init_app():
    await init_servo_controller()
    return app

def main():
    loop = asyncio.get_event_loop()
    loop.run_until_complete(init_servo_controller())
    web.run_app(app, host="0.0.0.0", port=1212)

if __name__ == '__main__':
    main() 