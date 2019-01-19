import Discord from 'discord.js'
import winston from 'winston'
import loki from 'lokijs'
import config from './config.json'

if (process.env.NODE_ENV === "dev") {
  config.channels = config.devchannels
}


let ENV = process.env.NODE_ENV
let discord = new Discord.Client();

// choose the enviroment variables as config if they exist
let { 
    DISCORD_TOKEN,
  } = process.env

let botToken = ENV === 'dev' ? config.discordTokenBeta : config.discordToken
if (DISCORD_TOKEN){ botToken = DISCORD_TOKEN }



console.log(process.env.NODE_ENV)

// setup the database
let db = new loki('mrps.db', {
  autoload: true,
	autoloadCallback : databaseInitialize,
	autosave: true, 
	autosaveInterval: 4000
});

// Afer the database loads up we'll call the main bot function to start the party
function databaseInitialize() {
  // Exaple loki db setup
  let motions = db.getCollection('motions')
  // See if it exists
  if (!motions) { // It doesn't, so create it
    db.addCollection('motions')
    motions = db.getCollection('motions')
  }
    
  bot({db: {motions: motions}}) // database is set up, so lets start the bot
}

console.log(`${process.env.NODE_ENV === 'production' ? 'error' : 'debug'}`)
// Configure logger settings
const logger = winston.createLogger({
  level: `${process.env.NODE_ENV === 'production' ? 'error' : 'debug'}`,
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({colorize: true}),
  ]
})

// Some logger function
function writeLog(message) {
  logger.log({level: 'debug', message: message})
}

function motionVote(motionText, msg) {
  let motions = db.getCollection('motions')

  // users can only submit one motion every 24 hours
  let existingMotion = motions.find({author: {"$eq": msg.author.id}})
  if (existingMotion.length) {
    let endDate = new Date(existingMotion[0].voteEnd)
    msg.author.send(`Hey! You already have an active motion! You can make a new one after ${endDate}`)
    return
  }

  try {
    let created = Date.now()
    let voteEnd = created + (ENV === "dev" ? 10000 : 86400000)
    let message, msgPublic

    let motion = {
      text: motionText,
      author: msg.author.id,
      created: created, 
      msg: null,
      msgPublic: null, 
      complete: false,
      ratio: null,
      passed: null,
      voteEnd: voteEnd,
      votes: {yea: 0, nay: 0}
    }

    discord.channels.get(config.channels.motionVotingPublic)
    .send(`
New Motion: ${motionText}
Author: <@${msg.author.id}>
Voting ends: ${new Date(voteEnd)}
`).then(msg => motion.msgPublic = msg.id)
    
    discord.channels.get(config.channels.motionVoting)
    .send(`
New Motion: ${motionText}
Author: <@${msg.author.id}>
Voting ends: ${new Date(voteEnd)}
`).then(msg => {
    msg.react("🔥").then(what => msg.react("💩")); 
    motion.msg = msg.id
  })

    motions.insert(motion)
  } catch (e) {
    logger.log(e)
  }
}

function clearMotion(msg) {
  let motions = db.getCollection('motions')
  let activeMotion = motions.find({"author": {"$eq": msg.author.id}})

  if (activeMotion.length) {
    writeLog(`clearing: ${activeMotion}`)
    discord.channels.get(config.channels.motionVoting)
      .fetchMessages({around: activeMotion.msg, limit: 1})
      .then(messages => {
        const msg = messages.first()
        msg.delete()
      })

    discord.channels.get(config.channels.motionVotingPublic)
      .fetchMessages({around: activeMotion.msgPublic, limit: 1})
      .then(messages => {
        const msgPublic = messages.first()
        msgPublic.delete()
      })

    motions.remove(activeMotion)

    msg.author.send("Your last motion has been deleted. You may create a new one!")
  } else {
    writeLog(`No motion found`)
    msg.author.send('You have no active motions!')
  }
}

function updateMotionStatus() {
  let motions = db.getCollection('motions')
  let finished = motions.find({complete: false, voteEnd: { "$lt": Date.now()} })

  if (finished.length) {
    finished.forEach(motion => {

      motion.complete = true
      discord.channels.get(config.channels.motionVoting)
        .fetchMessages({around: motion.msg, limit: 1})
          .then(messages => {
            let msg = messages.first() 
              msg.reactions.map(reaction => {
                switch(reaction.emoji.name) {
                  case "🔥":
                    motion.votes.yea = reaction.count - 1
                    break
                  case "💩":
                    motion.votes.nay = reaction.count - 1
                    break
                  default:
                }
              })

              motion.ratio = (parseInt(motion.votes.yea) / parseInt(motion.votes.nay)).toFixed(2)
              motion.passed = (parseInt(motion.votes.yea) / parseInt(motion.votes.nay).toFixed(2) > .50)
                ? true
                : false
        .error(error => writeLog(error))
              msg.edit(`
${msg.content}
Vote Passed: ${motion.passed}
Yea: ${motion.votes.yea} - Nay: ${motion.votes.nay}
                `)
          })

      let voteChannelPublic = discord.channels.get(config.channels.motionVotingPublic)
      voteChannelPublic.fetchMessages({around: motion.msgPublic, limit: 1})
        .then(messages => {
          const msgPublic = messages.first()
          msgPublic.edit(`
${msgPublic.content}
Vote Passed: ${motion.passed}
Yea: ${motion.votes.yea} - Nay: ${motion.votes.nay}
`)
        })

      // motion is finished, so we'll get rid of everything. It's saved in discord anyway
      motions.remove(motion)
    })
  }
}

// THIS IS THE MAGIC RIGHT HERE YA'LL
function bot(bot) {
  discord.on('ready', () => { 
    discord.setInterval(() => { // main loop runner
      updateMotionStatus()
    }, 1000)
    writeLog('ready')
  })

  discord.on('message', msg => {
    if (msg.author.bot) return;
    let commandChar = ENV == 'dev' ? '#' : '!'
    if (msg.content.indexOf(commandChar) !== 0) return;
    let args = msg.content.substring(1).split(' ')
    let cmd = args[0];
    let line = msg.content.split(/ (.+)/)[1]
    console.log(line)
    args = args.splice(1)

    switch(cmd) {
      // check to see if the bot is alive
      case "ping":
         writeLog("ping")
        msg.reply('pong')
        break
      case "motion":
        writeLog("casting a motion")
        motionVote(line, msg)
        break
      case "clearmotion":
        writeLog("clearing motions")
        clearMotion(msg)
      default:
    }
  })

  discord.login(botToken)
  .catch(error => writeLog(error))
}

process.on('SIGINT', () => {
  console.log("flushing database");
  db.close();
  process.exit()
})
