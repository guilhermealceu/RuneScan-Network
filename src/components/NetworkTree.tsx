import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Device } from '../types';
import { 
  Network, 
  Server, 
  Monitor, 
  Smartphone, 
  Printer, 
  Wifi, 
  Camera,
  ChevronRight,
  ShieldCheck,
  Activity,
  Cpu
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const getIcon = (type: Device['type']) => {
  switch (type) {
    case 'router': return <Network className="w-5 h-5" />;
    case 'switch': return <Activity className="w-5 h-5" />;
    case 'ap': return <Wifi className="w-5 h-5" />;
    case 'workstation': return <Monitor className="w-5 h-5" />;
    case 'server': return <Server className="w-5 h-5" />;
    case 'camera': return <Camera className="w-5 h-5" />;
    case 'printer': return <Printer className="w-5 h-5" />;
    case 'iot': return <Cpu className="w-5 h-5" />;
    default: return <Smartphone className="w-5 h-5" />;
  }
};

interface TreeNodeProps {
  device: Device;
  childrenDevices: Device[];
  allDevices: Device[];
  onSelect: (device: Device) => void;
  level?: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ device, childrenDevices, allDevices, onSelect, level = 0 }) => {
  return (
    <div className="flex flex-col">
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => onSelect(device)}
        className={cn(
          "group flex items-center gap-3 p-3 cursor-pointer border-b border-black/5 transition-colors",
          "hover:bg-scan-ink hover:text-white",
          device.status === 'offline' && "opacity-50 grayscale"
        )}
        style={{ paddingLeft: `${(level + 1) * 1.5}rem` }}
      >
        <div className="flex-shrink-0">
          {getIcon(device.type)}
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium truncate">{device.name}</span>
            {device.status === 'online' && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] opacity-60">
            <span className="font-mono">{device.ip}</span>
            <span>•</span>
            <span className="italic">{device.vlan}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </motion.div>
      
      {childrenDevices.length > 0 && (
        <div className="flex flex-col">
          {childrenDevices.map(child => (
            <TreeNode 
              key={child.id} 
              device={child} 
              childrenDevices={allDevices.filter(d => d.parentId === child.id)}
              allDevices={allDevices}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface NetworkTreeProps {
  devices: Device[];
  onSelectDevice: (device: Device) => void;
}

export const NetworkTree: React.FC<NetworkTreeProps> = ({ devices, onSelectDevice }) => {
  // Encontra dispositivos raiz (sem parentId ou cujo parentId não existe na lista)
  const rootDevices = useMemo(() => {
    return devices.filter(d => !d.parentId || !devices.find(p => p.id === d.parentId));
  }, [devices]);

  return (
    <div className="flex flex-col bg-white/50 rounded-lg overflow-hidden border border-black/10">
      <div className="p-4 bg-scan-ink text-white flex items-center justify-between">
        <h3 className="font-serif italic text-sm uppercase tracking-wider">Topologia de Rede</h3>
        <ShieldCheck className="w-4 h-4 opacity-50" />
      </div>
      <div className="flex-grow overflow-y-auto max-h-[600px]">
        {rootDevices.map(device => (
          <TreeNode 
            key={device.id} 
            device={device} 
            childrenDevices={devices.filter(d => d.parentId === device.id)}
            allDevices={devices}
            onSelect={onSelectDevice}
          />
        ))}
        {devices.length === 0 && (
          <div className="p-12 text-center text-sm font-mono opacity-50 italic">
            Nenhum dispositivo encontrado na varredura.
          </div>
        )}
      </div>
    </div>
  );
};
