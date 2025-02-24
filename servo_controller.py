import time
import numpy as np
import traceback
import scservo_sdk as scs

PROTOCOL_VERSION = 0
BAUDRATE = 1_000_000
TIMEOUT_MS = 1000
NUM_READ_RETRY = 20
NUM_WRITE_RETRY = 20

SCS_SERIES_CONTROL_TABLE = {
    "Torque_Enable":          (40, 1),
    "Goal_Position":          (42, 2),
    "Present_Position":       (56, 2),
}

MODEL_RESOLUTION = 4096

class DeviceNotConnectedError(Exception):
    pass

class DeviceAlreadyConnectedError(Exception):
    pass

class ServoError(Exception):
    pass

class FeetechController:
    def __init__(self, port, servo_ids):
        self.port = port
        self.servo_ids = servo_ids
        
        self.port_handler = None
        self.packet_handler = None
        self.is_connected = False
        
        self.group_readers = {}
        self.group_writers = {}

    def connect(self):
        if self.is_connected:
            raise DeviceAlreadyConnectedError("Controller is already connected.")

        self.port_handler = scs.PortHandler(self.port)
        self.packet_handler = scs.PacketHandler(PROTOCOL_VERSION)

        try:
            if not self.port_handler.openPort():
                raise OSError(f"Failed to open port '{self.port}'.")

            if not self.port_handler.setBaudRate(BAUDRATE):
                raise OSError(f"Failed to set baud rate '{BAUDRATE}' on port '{self.port}'.")

            self.port_handler.setPacketTimeoutMillis(TIMEOUT_MS)
            self.is_connected = True

            print(f"[FeetechController] Connected on port={self.port} at baud={BAUDRATE}")

        except Exception as e:
            traceback.print_exc()
            if self.port_handler:
                self.port_handler.closePort()
            self.port_handler = None
            self.packet_handler = None
            raise e

    def disconnect(self):
        if not self.is_connected:
            raise DeviceNotConnectedError("Controller is not connected.")

        if self.port_handler:
            self.port_handler.closePort()
            self.port_handler = None

        self.packet_handler = None
        self.group_readers = {}
        self.group_writers = {}
        self.is_connected = False

        print("[FeetechController] Disconnected.")

    def read(self, data_name, servo_ids=None):
        if not self.is_connected:
            raise DeviceNotConnectedError("Controller is not connected.")

        if servo_ids is None:
            servo_ids = self.servo_ids
        if isinstance(servo_ids, int):
            servo_ids = [servo_ids]

        if data_name not in SCS_SERIES_CONTROL_TABLE:
            raise ValueError(f"Unknown data_name '{data_name}' not in control table.")
        addr, size = SCS_SERIES_CONTROL_TABLE[data_name]

        group_key = f"{data_name}_{'_'.join(map(str, servo_ids))}"
        if group_key not in self.group_readers:
            self.port_handler.ser.reset_output_buffer()
            self.port_handler.ser.reset_input_buffer()

            self.group_readers[group_key] = scs.GroupSyncRead(self.port_handler, self.packet_handler, addr, size)
            for servo_id in servo_ids:
                self.group_readers[group_key].addParam(servo_id)

        for _ in range(NUM_READ_RETRY):
            comm_result = self.group_readers[group_key].txRxPacket()
            if comm_result == scs.COMM_SUCCESS:
                break
        if comm_result != scs.COMM_SUCCESS:
            raise ServoError(
                f"[read] Communication error: {self.packet_handler.getTxRxResult(comm_result)}"
            )

        values = []
        for servo_id in servo_ids:
            val = self.group_readers[group_key].getData(servo_id, addr, size)
            values.append(val)

        return np.array(values, dtype=np.int32)

    def write(self, data_name, values, servo_ids=None):
        if not self.is_connected:
            raise DeviceNotConnectedError("Controller is not connected.")

        if servo_ids is None:
            servo_ids = self.servo_ids
        if isinstance(servo_ids, int):
            servo_ids = [servo_ids]

        if isinstance(values, (int, float, np.integer)):
            values = [values] * len(servo_ids)
        values = np.array(values, dtype=np.int32)

        if data_name not in SCS_SERIES_CONTROL_TABLE:
            raise ValueError(f"Unknown data_name '{data_name}' not in control table.")
        addr, size = SCS_SERIES_CONTROL_TABLE[data_name]

        group_key = f"{data_name}_{'_'.join(map(str, servo_ids))}"
        if group_key not in self.group_writers:
            self.group_writers[group_key] = scs.GroupSyncWrite(self.port_handler, self.packet_handler, addr, size)

            for servo_id, val in zip(servo_ids, values, strict=True):
                data = self._convert_to_bytes(val, size)
                self.group_writers[group_key].addParam(servo_id, data)
        else:
            for servo_id, val in zip(servo_ids, values, strict=True):
                data = self._convert_to_bytes(val, size)
                self.group_writers[group_key].changeParam(servo_id, data)

        for _ in range(NUM_WRITE_RETRY):
            comm_result = self.group_writers[group_key].txPacket()
            if comm_result == scs.COMM_SUCCESS:
                break
        if comm_result != scs.COMM_SUCCESS:
            raise ServoError(
                f"[write] Communication error: {self.packet_handler.getTxRxResult(comm_result)}"
            )

    def _convert_to_bytes(self, value, size):
        if size == 1:
            return [value & 0xFF]
        elif size == 2:
            return [(value & 0xFF), ((value >> 8) & 0xFF)]
        elif size == 4:
            return [
                (value & 0xFF),
                ((value >> 8) & 0xFF),
                ((value >> 16) & 0xFF),
                ((value >> 24) & 0xFF),
            ]
        else:
            raise ValueError(f"Unsupported size={size} for _convert_to_bytes")

    def enable_torque(self, servo_ids=None):
        if servo_ids is None:
            servo_ids = self.servo_ids
        self.write("Torque_Enable", 1, servo_ids)

    def disable_torque(self, servo_ids=None):
        if servo_ids is None:
            servo_ids = self.servo_ids
        self.write("Torque_Enable", 0, servo_ids)

    def get_position(self, servo_id, retry_count=3):
        for attempt in range(retry_count):
            try:
                val = self.read("Present_Position", servo_id)
                if val.size > 0:
                    return int(val[0])
            except Exception as e:
                if attempt < retry_count - 1:
                    time.sleep(0.05)
                else:
                    print(f"[get_position] Failed reading servo {servo_id}: {e}")
        return None

    def get_all_positions(self):
        vals = self.read("Present_Position")
        return {servo_id: int(vals[i]) for i, servo_id in enumerate(self.servo_ids)}

    def set_position(self, servo_id, position, retry_count=3):
        for attempt in range(retry_count):
            try:
                self.write("Goal_Position", position, servo_id)
                return
            except Exception as e:
                if attempt < retry_count - 1:
                    time.sleep(0.05)
                    print(f"[set_position] Retry {attempt+1}/{retry_count} for servo {servo_id}")
                else:
                    raise e

    def set_all_positions(self, position, delay=0.1):
        for servo_id in self.servo_ids:
            self.set_position(servo_id, position)
            time.sleep(delay)

    def center_all(self):
        self.write("Goal_Position", 2048, self.servo_ids)

    def print_all_positions(self):
        pos_dict = self.get_all_positions()
        for servo_id, val in pos_dict.items():
            print(f"Servo {servo_id}: {val}")

    def get_position_degrees(self, servo_id, retry_count=3):
        raw_position = self.get_position(servo_id, retry_count)
        if raw_position is None:
            return None
            
        position_centered = raw_position - 2048
        position_degrees = position_centered / 2048 * 120 * 1.5
        
        return position_degrees
        
    def get_all_positions_degrees(self):
        raw_positions = self.get_all_positions()
        degree_positions = {}
        
        for servo_id, raw_pos in raw_positions.items():
            position_centered = raw_pos - 2048
            position_degrees = position_centered / 2048 * 120 * 1.5
            degree_positions[servo_id] = position_degrees
            
        return degree_positions
        
    def print_all_positions_degrees(self):
        pos_dict = self.get_all_positions_degrees()
        for servo_id, val in pos_dict.items():
            print(f"Servo {servo_id}: {val:.2f}°")
            
    def monitor_positions(self, update_interval=0.1, duration=None):
        print("Monitoring servo positions. Press Ctrl+C to stop.")
        print("Center position is 0 degrees, range is -180 to 180 degrees")
        
        start_time = time.time()
        try:
            while True:
                if duration is not None and time.time() - start_time > duration:
                    break
                    
                positions = self.get_all_positions_degrees()
                
                print("\r", end="")
                output = []
                for servo_id, pos in positions.items():
                    output.append(f"Servo {servo_id}: {pos:.2f}°")
                print(" | ".join(output), end="")
                
                time.sleep(update_interval)
                
        except KeyboardInterrupt:
            print("\nMonitoring stopped by user.")