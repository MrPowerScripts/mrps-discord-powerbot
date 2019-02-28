import winston from 'winston'

export const SCENE_FILES_DIR = "workdir"

export const videoOptions = {
  fps: 30,
  loop: 5, // seconds
  transition: false,
  transitionDuration: 1, // seconds
  videoBitrate: 1024,
  videoCodec: 'libx264',
  size: '1920x?',
  audioBitrate: '128k',
  audioChannels: 2,
  format: 'mp4',
  pixelFormat: 'yuv420p'
}

// Configure logger settings
const logger = winston.createLogger({
  level: `${process.env.NODE_ENV === 'production' ? 'error' : 'debug'}`,
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error', maxsize: 1048576 }),
    new winston.transports.File({ filename: 'combined.log', maxsize: 1048576  }),
    new winston.transports.Console({colorize: true}),
  ]
})
  
// Some logger function
export function writeLog(message) {
  logger.log({level: 'debug', time: Math.floor((new Date).getTime()/1000), message: message})
}