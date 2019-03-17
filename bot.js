import Discord from 'discord.js'
import { writeLog, botCommandHelp } from './utils'
import loki from 'lokijs'
import config from './config.json'
import { build, publish } from './veditor'
import 'babel-polyfill'

if (process.env.NODE_ENV === "dev") {
  config.channels = config.devchannels

  var lines = process.stdout.getWindowSize()[1];
  for(var i = 0; i < lines; i++) {
      console.log('\r\n');
  }
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


function motionVote(motionText, msg) {
  let motions = db.getCollection('motions')

  // users can only submit one motion every 24 hours
  let existingMotion = motions.find({author: {"$eq": msg.author.id}})
  if (existingMotion.length) {
    let endDate = new Date(existingMotion[0].voteEnd)
    msg.author.send(`Hey! You already have an active motion! You can remove the current one with !clearmotion or wait till after your current motione ends`)
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

    writeLog(`adding motion : ${JSON.stringify(motion)}`)
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
        writeLog(messages)
        const msgPublic = messages.first()
        //writeLog(msgPublic)
        msgPublic.delete()
      })

    motions.remove(activeMotion)

    msg.author.send("Your last motion has been deleted. You may create a new one!")
  } else {
    writeLog(`No motion found`)
    msg.author.send('You have no active motions!')
  }
}

function draftVideoPublished(url) {
  discord.channels.get(config.channels.motionVotingPublic)
  .send(`
New draft published:
${url}
`).then(msg => {
  msg.react("🔥").then(what => msg.react("💩")); 
})//.then(msg => motion.msgPublic = msg.id)
  
  discord.channels.get(config.channels.motionVoting)
  .send(`
New draft published:
${url}
`).then(msg => {
  msg.react("🔥").then(what => msg.react("💩")); 
})
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

function hasRole(msg, role) {
  
  let allowedRole = msg.guild.roles.find(x => x.name === `${role}`)

  if (msg.member.roles.has(allowedRole.id)) {
    writeLog(`${msg.author.id} has role ${role}`)
    return true
  } else {
    writeLog(`${msg.author.id} doesn't have role ${role}`)
    msg.author.send("Power Up your experience and get access to cool stuff. Visit https://bit.ly/mrps-powerup to learn more")
    return false
  }
}

// THIS IS THE MAGIC RIGHT HERE YA'LL
function bot(bot) {
  discord.on('ready', () => { 
    discord.channels.get(config.channels.general).send("bot starting")
    discord.setInterval(() => { // main loop runner
      updateMotionStatus()
    }, 1000)
    writeLog('ready')
  })

  discord.on('message', async msg => {
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
      case "help":
        msg.reply(botCommandHelp)
        break
      case "ping":
         writeLog("ping")
         if (hasRole(msg, 'Powered Up')) {
          msg.reply('pong')
        }
        break
      case "build":
        writeLog("building from script")
        if (hasRole(msg, 'MrPowerScripts')) {
          try {
            build(line)
          } catch (e) { console.log(e)}
        }
        break
      case "publish":
        writeLog('publishing')
        if (hasRole(msg, 'MrPowerScripts')) {
          try {
            publish(line, draftVideoPublished)
          } catch (e){ console.log(e)}
        }
        break
      case "motion":
        writeLog("casting a motion")
        if (hasRole(msg, 'Powered Up')) {
          motionVote(line, msg)
        }
        break
      case "clearmotion":
        writeLog("clearing motions")
        if (hasRole(msg, 'Powered Up')) {
          clearMotion(msg)
        }
      default:
    }
  })

  discord.on('error', error => console.log(error))

  discord.login(botToken)
  .catch(error => writeLog(error))
}

process.on('error', (error) => {
  console.log(error)
})

process.on('SIGINT', () => {
  console.log("flushing database");
  db.close();
  process.exit()
})
