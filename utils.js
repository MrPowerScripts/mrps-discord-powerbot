import winston from 'winston'

export const APP_DIR = __dirname
export const SCENE_FILES_DIR = `${APP_DIR}/workdir`
export const ARC_SCRIPTS = "https://raw.githubusercontent.com/MrPowerScripts/automated-reality-channel/master/scripts/"

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

export function arcURL(ep) {
  if (ep === 'test') {
    return "https://raw.githubusercontent.com/MrPowerScripts/automated-reality-channel/master/sample-script.yml"
  } else if (isNaN(parseInt(ep))) {
    return ep
  } else {
    return ARC_SCRIPTS + `arc-ep-${ep}.yml`;
  }
}

function youtube_parser(url){
  var regExp = /^.*(youtu.be\/|youtube(-nocookie)?.com\/(v\/|.*u\/\w\/|embed\/|.*v=))([\w-]{11}).*/;
  var match = url.match(regExp);
  return (match&&match[7].length==11)? match[7] : false;
}
