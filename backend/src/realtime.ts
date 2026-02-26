import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export const setIo = (instance: SocketIOServer) => {
  io = instance;
};

export const getIo = () => {
  if (!io) {
    throw new Error('SOCKET_IO_NOT_INITIALIZED');
  }

  return io;
};

export const sessionRoom = (sessionId: string) => `session:${sessionId}`;
