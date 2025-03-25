from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import asyncio
import uvicorn
from core.servos import Servos
from contextlib import asynccontextmanager
from typing import Optional
from pydantic import BaseModel

@asynccontextmanager
async def lifespan(app: FastAPI):
    global servo_controller, sse_clients
    try:
        print("Initializing servo controller...")
        servo_controller = Servos()
        servo_controller.connect()
        asyncio.create_task(broadcast_positions())
        print("Servo controller initialized successfully")
    except Exception as e:
        print(f"Error initializing servo controller: {e}")
        servo_controller = None
    yield

app = FastAPI(lifespan=lifespan)
servo_controller = None
is_calibrating = False
sse_clients = {}  # Changed from set to dict using client IDs as keys

# CORS Configuration - Simplified
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,  # Cache preflight for 24 hours
)

# SSE client management
async def add_sse_client(client_id: str, queue: asyncio.Queue):
    sse_clients[client_id] = queue

async def remove_sse_client(client_id: str):
    if client_id in sse_clients:
        del sse_clients[client_id]

async def send_sse_message(client_id: str, data: str):
    try:
        if client_id in sse_clients:
            await sse_clients[client_id].put(data)
    except:
        await remove_sse_client(client_id)

async def broadcast_sse_message(data: str):
    for client_id in list(sse_clients.keys()):
        await send_sse_message(client_id, data)

# Continuously broadcast servo positions via SSE
async def broadcast_positions():
    last_broadcast = {}
    broadcast_interval = 0.25
    
    while True:
        try:
            if sse_clients and servo_controller and servo_controller.connected and not is_calibrating:
                try:
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
                            'positions': positions
                        })
                        await broadcast_sse_message(message)
                        last_broadcast = positions.copy()
                except Exception as e:
                    print(f"Error in broadcast_positions: {e}")
            
            await asyncio.sleep(broadcast_interval)
                
        except Exception as e:
            print(f"Outer error in broadcast_positions: {e}")
            await asyncio.sleep(1)

# Pydantic models for request validation
class ServoUpdate(BaseModel):
    servo_id: int
    position: float

class TorqueControl(BaseModel):
    enabled: bool

class CalibrationStep(BaseModel):
    joint: str
    angle: float
    step_number: int
    total_steps: Optional[int] = 1

class CapturePosition(BaseModel):
    joint: str
    angle: float
    step_number: int

# SSE endpoint
@app.get("/api/events")
async def sse(request: Request):
    client_id = f"client_{id(request)}_{asyncio.get_event_loop().time()}"
    queue = asyncio.Queue()
    
    await add_sse_client(client_id, queue)
    
    # Send initial positions
    try:
        if servo_controller and servo_controller.connected:
            positions = servo_controller.get_angles()
            await send_sse_message(client_id, json.dumps({
                'type': 'servo_positions',
                'positions': positions
            }))
    except Exception as e:
        print(f"Error sending initial positions: {e}")
        # Continue anyway
    
    async def event_generator():
        try:
            while True:
                data = await queue.get()
                if data == "close":
                    break
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await remove_sse_client(client_id)
    
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # For NGINX
        "Content-Type": "text/event-stream",
        "Access-Control-Allow-Origin": "http://localhost:5173",
        "Access-Control-Allow-Credentials": "true"
    }
    
    return StreamingResponse(
        event_generator(),
        headers=headers
    )

# REST API endpoints
@app.post("/api/servo")
async def update_servo(data: ServoUpdate):
    if servo_controller and servo_controller.connected:
        try:
            servo_controller.set_angle({data.servo_id: data.position})
            return {"status": "success", "servo_id": data.servo_id, "position": data.position}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Servo controller not connected"}

@app.post("/api/center-all")
async def center_all():
    if servo_controller and servo_controller.connected:
        angles = {servo_id: 0 for servo_id in servo_controller.get_servos()}
        servo_controller.set_angle(angles)
        return {"status": "success"}
    return {"status": "error", "message": "Servo controller not connected"}

@app.get("/api/positions")
async def get_positions():
    if servo_controller and servo_controller.connected:
        positions = servo_controller.get_angles()
        return {"status": "success", "positions": positions}
    return {"status": "error", "message": "Servo controller not connected"}

@app.get("/api/torque")
async def get_torque():
    if servo_controller and servo_controller.connected:
        enabled = servo_controller.get_torque_enabled()
        return {"status": "success", "enabled": enabled}
    return {"status": "error", "message": "Servo controller not connected"}

@app.post("/api/torque")
async def set_torque(data: TorqueControl):
    if servo_controller and servo_controller.connected:
        servo_controller.set_torque_enabled(data.enabled)
        return {"status": "success", "enabled": data.enabled}
    return {"status": "error", "message": "Servo controller not connected"}

# Calibration endpoints
@app.post("/api/calibration/start")
async def start_calibration():
    global is_calibrating
    if servo_controller and servo_controller.connected:
        try:
            is_calibrating = True
            servo_controller.start_calibration()
            return {"status": "success", "message": "Calibration mode started"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Servo controller not connected"}

@app.post("/api/calibration/capture")
async def capture_position(data: CapturePosition):
    if servo_controller and servo_controller.connected and is_calibrating:
        servo_id = int(data.joint)
        current_pos = servo_controller.get_positions()[servo_id]
        
        # Map angle to calibration point
        calibration_point = "zero"
        if data.angle == 90:
            calibration_point = "max"
        elif data.angle == -90:
            calibration_point = "min"
            
        servo_controller.set_calibration_point(
            servo_id,
            calibration_point,
            current_pos
        )
        
        return {
            "status": "success",
            "joint": data.joint,
            "angle": data.angle,
            "position": current_pos
        }
    return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}

@app.post("/api/calibration/complete")
async def complete_calibration():
    global is_calibrating
    if servo_controller and servo_controller.connected and is_calibrating:
        is_calibrating = False
        servo_controller.end_calibration()
        servo_controller.set_torque_enabled(True)
        return {"status": "success", "message": "Calibration completed successfully"}
    return {"status": "error", "message": "Not in calibration mode or servo controller not connected"}

@app.post("/api/calibration/cancel")
async def cancel_calibration():
    global is_calibrating
    if servo_controller and servo_controller.connected and is_calibrating:
        is_calibrating = False
        servo_controller.cancel_calibration()
        servo_controller.set_torque_enabled(True)
        positions = servo_controller.get_angles()
        return {"status": "success", "message": "Calibration canceled", "positions": positions}
    return {"status": "success", "message": "Not in calibration mode"}

def main():
    uvicorn.run(app, host="0.0.0.0", port=1212)

if __name__ == '__main__':
    main() 