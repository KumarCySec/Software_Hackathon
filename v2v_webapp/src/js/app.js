var gk_isXlsx = false;
var gk_xlsxFileLookup = {};
var gk_fileData = {};
function loadFileData(filename) {
  if (gk_isXlsx && gk_xlsxFileLookup[filename]) {
    try {
      var workbook = XLSX.read(gk_fileData[filename], { type: 'base64' });
      var firstSheetName = workbook.SheetNames[0];
      var worksheet = workbook.Sheets[firstSheetName];
      var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
      var filteredData = jsonData.filter(row =>
        row.some(cell => cell !== '' && cell !== null && cell !== undefined)
      );
      var csv = XLSX.utils.aoa_to_sheet(filteredData);
      csv = XLSX.utils.sheet_to_csv(csv, { header: 1 });
      return csv;
    } catch (e) {
      console.error(e);
      return "";
    }
  }
  return gk_fileData[filename] || "";
}

const { useState, useEffect, useRef } = React;

// Simulated WebSocket for V2V communication
const createMockWebSocket = () => {
  const listeners = {};
  return {
    send: (data) => {
      console.log('Mock WebSocket sent:', data);
      setTimeout(() => {
        if (listeners.message) {
          listeners.message({ data: JSON.stringify({ type: 'ack', payload: JSON.parse(data) }) });
        }
      }, 500);
    },
    addEventListener: (event, callback) => {
      listeners[event] = callback;
    },
    removeEventListener: (event) => {
      delete listeners[event];
    }
  };
};
const socket = createMockWebSocket();

// Initial vehicle data
const initialVehicles = [
  { id: 1, name: 'Car 1', x: 300, y: 350, speed: 0, direction: 90, blindSpot: false, braking: false, alerts: [] },
  { id: 2, name: 'Car 2', x: 300, y: 300, speed: 0, direction: 90, blindSpot: false, braking: false, alerts: [] },
];

// Speedometer Component
const Speedometer = ({ speed }) => {
  const rotation = (speed / 100) * 270;
  return (
    <div className="relative w-32 h-32 mx-auto">
      <svg className="speedometer w-full h-full" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#444" strokeWidth="10" />
        <circle cx="50" cy="50" r="45" fill="none" stroke="#3b82f6" strokeWidth="10" strokeDasharray="283" strokeDashoffset={283 * (1 - speed / 100)} />
        <line
          className="needle"
          x1="50"
          y1="50"
          x2="50"
          y2="15"
          stroke="#ef4444"
          strokeWidth="3"
          transform={`rotate(${rotation} 50 50)`}
        />
      </svg>
      <div className="absolute top-3/4 left-1/2 transform -translate-x-1/2 text-center">
        <span className="text-xl font-bold">{speed}</span>
        <span className="text-sm"> km/h</span>
      </div>
    </div>
  );
};

// Road Simulation Component
const RoadSimulation = ({ vehicles, width = 600, height = 400, isMinimap = false }) => {
  const scale = isMinimap ? 0.5 : 1;
  return (
    <svg width={width} height={height} className="road rounded-xl shadow-2xl" viewBox={`0 0 ${600 * scale} ${400 * scale}`}>
      <path
        d="M250 50 H350 V350 H250 V50 Z M350 50 H600 V150 H350 Z M0 50 H250 V150 H0 Z"
        fill="#4b5563"
      />
      <path
        d="M300 50 V350 M0 100 H600"
        stroke="#fff"
        strokeWidth={isMinimap ? 2 : 4}
        strokeDasharray="10,10"
        fill="none"
      />
      {vehicles.map((vehicle) => (
        <g key={vehicle.id} className="vehicle" transform={`translate(${vehicle.x * scale}, ${vehicle.y * scale}) rotate(${vehicle.direction})`}>
          <rect x="-15" y="-10" width="30" height="20" fill={vehicle.id === 1 ? '#3b82f6' : '#ef4444'} rx="5" />
          {isMinimap && (
            <text x="20" y="0" fill="#fff" fontSize="12" transform={`rotate(${-vehicle.direction})`}>
              {vehicle.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

// Main App Component
const V2VApp = () => {
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [sosAlert, setSosAlert] = useState(null);
  const [emergencyAlert, setEmergencyAlert] = useState(null);
  const mouseDownRef = useRef({});

  useEffect(() => {
    const interval = setInterval(() => {
      setVehicles((prev) => {
        const updated = prev.map((v) => {
          if (v.braking) return { ...v, speed: 0 };
          const speedPx = v.speed / 10;
          const xChange = speedPx * Math.cos((v.direction * Math.PI) / 180);
          const yChange = -speedPx * Math.sin((v.direction * Math.PI) / 180);
          const newX = Math.max(0, Math.min(600, v.x + xChange));
          const newY = Math.max(50, Math.min(350, v.y + yChange));
          const other = prev.find((o) => o.id !== v.id);
          const blindSpot = Math.hypot(newX - other.x, newY - other.y) < 50;
          if (blindSpot && !v.blindSpot) {
            socket.send(JSON.stringify({ type: 'blind_spot', from: v.id, to: other.id }));
            setVehicles((curr) =>
              curr.map((c) =>
                c.id === other.id ? { ...c, alerts: [...c.alerts, `Blind spot warning from ${v.name}`] } : c
              )
            );
          }
          return {
            ...v,
            x: newX,
            y: newY,
            blindSpot,
            alerts: v.alerts.filter((a) => a.includes('Blind spot')),
          };
        });
        return updated;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Received:', data);
    };
    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, []);

  const controlVehicle = (vehicleId, action) => {
    setVehicles((prev) => {
      const updated = prev.map((v) => {
        if (v.id !== vehicleId) return v;
        switch (action) {
          case 'left':
            socket.send(JSON.stringify({ type: 'control', vehicleId, action: 'turn_left' }));
            return { ...v, direction: v.direction + 5 };
          case 'right':
            socket.send(JSON.stringify({ type: 'control', vehicleId, action: 'turn_right' }));
            return { ...v, direction: v.direction - 5 };
          case 'accelerate':
            socket.send(JSON.stringify({ type: 'control', vehicleId, action: 'accelerate' }));
            return { ...v, speed: Math.min(v.speed + 5, 100), braking: false };
          case 'brake':
            socket.send(JSON.stringify({ type: 'control', vehicleId, action: 'brake' }));
            const other = prev.find((o) => o.id !== v.id);
            socket.send(JSON.stringify({ type: 'sos', from: v.id, to: other.id, reason: 'sudden_brake' }));
            setSosAlert({ from: v.name, to: other.name, reason: 'Sudden braking detected' });
            setTimeout(() => setSosAlert(null), 5000);
            setVehicles((curr) =>
              curr.map((c) =>
                c.id === other.id
                  ? { ...c, alerts: [...c.alerts, `Sudden brake by ${v.name}`] }
                  : c
              )
            );
            return { ...v, speed: 0, braking: true };
          default:
            return v;
        }
      });
      updated.forEach((v) => {
        socket.send(JSON.stringify({ type: 'vehicle_data', vehicleId: v.id, data: v }));
      });
      return updated;
    });
  };

  const handleMouseDown = (vehicleId, e) => {
    mouseDownRef.current[vehicleId] = { x: e.clientX };
  };

  const handleMouseMove = (vehicleId, e) => {
    if (!mouseDownRef.current[vehicleId]) return;
    const deltaX = e.clientX - mouseDownRef.current[vehicleId].x;
    if (Math.abs(deltaX) > 20) {
      const action = deltaX > 0 ? 'right' : 'left';
      controlVehicle(vehicleId, action);
      mouseDownRef.current[vehicleId].x = e.clientX;
    }
  };

  const handleMouseUp = (vehicleId) => {
    delete mouseDownRef.current[vehicleId];
  };

  const triggerSos = (vehicleId) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    const other = vehicles.find((v) => v.id !== vehicleId);
    setSosAlert({ from: vehicle.name, to: other.name, reason: 'Manual SOS triggered' });
    socket.send(JSON.stringify({ type: 'sos', from: vehicleId, to: other.id, reason: 'manual' }));
    setVehicles((prev) =>
      prev.map((v) =>
        v.id === other.id ? { ...v, alerts: [...v.alerts, `SOS from ${vehicle.name}`] } : v
      )
    );
    setTimeout(() => setSosAlert(null), 5000);
  };

  const triggerEmergency = (vehicleId) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    const other = vehicles.find((v) => v.id !== vehicleId);
    setEmergencyAlert({ from: vehicle.name, to: other.name, reason: 'Emergency situation' });
    socket.send(JSON.stringify({ type: 'emergency', from: vehicleId, to: other.id }));
    setVehicles((prev) =>
      prev.map((v) =>
        v.id === other.id
          ? { ...v, alerts: [...v.alerts, `Emergency from ${vehicle.name}`] }
          : v
      )
    );
    setTimeout(() => setEmergencyAlert(null), 5000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-gray-900 p-6">
      <h1 className="text-5xl font-extrabold text-center mb-8 text-blue-400 animate-pulse tracking-tight">
        V2V Communication Dashboard
      </h1>
      <div className="mb-8">
        <h2 className="text-3xl font-semibold mb-4 text-white">T-Shaped Road Simulation</h2>
        <RoadSimulation vehicles={vehicles} />
      </div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-white">Minimap Overview</h2>
        <RoadSimulation vehicles={vehicles} width={300} height={200} isMinimap={true} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {vehicles.map((vehicle) => (
          <div
            key={vehicle.id}
            className="info-panel p-6 rounded-xl shadow-2xl hover:shadow-blue-500/20 transition-all duration-300 border border-gray-600"
          >
            <h3 className="text-2xl font-bold mb-4 text-blue-300">{vehicle.name}</h3>
            <Speedometer speed={vehicle.speed} />
            <div className="mt-2 space-y-2">
              <p>Direction: {vehicle.direction}°</p>
              <p>Position: ({Math.round(vehicle.x)}, {Math.round(vehicle.y)})</p>
              <p>Braking: {vehicle.braking ? 'Yes' : 'No'}</p>
              <p>
                Blind Spot:{' '}
                <span className={vehicle.blindSpot ? 'text-red-500' : 'text-green-500'}>
                  {vehicle.blindSpot ? 'Detected' : 'Clear'}
                </span>
              </p>
              <p>Alerts:</p>
              <ul className="list-disc pl-5 text-sm">
                {vehicle.alerts.length > 0 ? (
                  vehicle.alerts.map((alert, index) => (
                    <li key={index} className="text-yellow-400">{alert}</li>
                  ))
                ) : (
                  <li className="text-gray-400">None</li>
                )}
              </ul>
            </div>
            <div
              className="control-panel bg-gray-900 h-16 mt-4 rounded-lg flex items-center justify-center border border-gray-600"
              onMouseDown={(e) => handleMouseDown(vehicle.id, e)}
              onMouseMove={(e) => handleMouseMove(vehicle.id, e)}
              onMouseUp={() => handleMouseUp(vehicle.id)}
              onMouseLeave={() => handleMouseUp(vehicle.id)}
            >
              <span className="text-gray-400">Drag left/right to steer</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                onClick={() => controlVehicle(vehicle.id, 'left')}
                className="control-btn bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg"
              >
                Left
              </button>
              <button
                onClick={() => controlVehicle(vehicle.id, 'right')}
                className="control-btn bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg"
              >
                Right
              </button>
              <button
                onClick={() => controlVehicle(vehicle.id, 'accelerate')}
                className="control-btn bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg"
              >
                Accelerate
              </button>
              <button
                onClick={() => controlVehicle(vehicle.id, 'brake')}
                className="control-btn bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg"
              >
                Brake
              </button>
            </div>
            <div className="flex justify-between mt-4">
              <button
                onClick={() => triggerSos(vehicle.id)}
                className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg transform hover:scale-105 transition"
              >
                SOS
              </button>
              <button
                onClick={() => triggerEmergency(vehicle.id)}
                className="bg-yellow-600 hover:bg-yellow-700 text-white py-2 px-4 rounded-lg transform hover:scale-105 transition"
              >
                Emergency
              </button>
            </div>
          </div>
        ))}
      </div>
      {sosAlert && (
        <div className="fixed top-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-2xl animate-bounce">
          SOS Alert: {sosAlert.from} to {sosAlert.to}: {sosAlert.reason}
        </div>
      )}
      {emergencyAlert && (
        <div className="fixed top-20 right-4 bg-yellow-600 text-white p-4 rounded-lg shadow-2xl animate-bounce">
          Emergency Alert: {emergencyAlert.from} to {emergencyAlert.to}: {emergencyAlert.reason}
        </div>
      )}
    </div>
  );
};

// Render the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<V2VApp />);