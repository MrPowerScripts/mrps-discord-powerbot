import rp from 'request-promise'
import yaml from 'js-yaml'
import fs from 'fs'
import glob from 'glob'
import speak from 'espeak'
import getURLs from 'get-urls'
//import festival from 'festival'
import { writeLog, SCENE_FILES_DIR, APP_DIR, arcURL } from './utils'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { spawnSync } from 'child_process';

// maybe need this? qt-faststart
exports.build = async function build(scriptURL) {
  writeLog("veditor- building script")

  // use some hard codded commands for various builds
  switch (scriptURL) {
    case "test":
      scriptURL = arcURL('test')
      break
    default:
      scriptURL = arcURL(scriptURL)

  }
  // make the workdir if it doesn't exist
  if (!fs.existsSync(SCENE_FILES_DIR)) {
    fs.mkdirSync(SCENE_FILES_DIR);
  }
  // cleanup workdir first for each scene
  writeLog('Cleanup workdir')
  glob(`${SCENE_FILES_DIR}/*`, {}, (err, files) => {
    files.forEach(file => fs.unlinkSync(file))
  })

  // create a random string to use as a file prefix
  let filePrefix = Math.random().toString(36).substr(2, 5)

  writeLog('downloading script')
  console.log(scriptURL)
  let script = await rp(scriptURL).then(async resp => yaml.safeLoad(resp)) // loading the script yaml file

  let promises = []
  let media = []

  // process every scene to create individual scene videos
  script.scenes.forEach(async (scene, idx) => {
    let sceneMedia = {}
    let pre = `${filePrefix}-${idx}` // prefix all files to make them unique per scene
    sceneMedia.prefix = pre


    writeLog('downloading scene audio')
    let audio = `${SCENE_FILES_DIR}/${pre}-audio.wav`
    if (scene.audio_media == 'tts') {
      // auto generate tts audio
      //festival.toSpeech(scene.audio_script, `${SCENE_FILES_DIR}/${pre}-audio.mp3`)
      speak.speak(scene.audio_script, (err, wave) => {
        fs.writeFileSync(audio, wave.buffer)
      })
    } else { }// do stuff to grab remote audio and process
    sceneMedia.audio = audio


    let visual = `${SCENE_FILES_DIR}/${pre}-visual.${scene.visual_type}`
    writeLog('cehcking scene visual')
    switch (scene.visual_type) {
      case "jpg":
      case "jpeg":
      case "png":
        writeLog('it is an image')
        promises.push(rp(scene.visual_media, { encoding: null })
          .then(resp => {
            writeLog(`saving media: ${scene.visual_media}`)
            fs.writeFileSync(visual, resp)
          }))
        sceneMedia.image = visual
        break
      default:
        break
    }
    media.push(sceneMedia)
  })

  await Promise.all(promises)
  writeLog('we waited')

  // convert images to videos with their audio
  promises = []
  media.forEach(async (item, idx, arr) => {
    if (item.hasOwnProperty('image')) {
      promises.push(new Promise((resolve, reject) => {

        let videoName = `${item.image.replace(/\.[^/.]+$/, "")}-stitch.mkv`

        let args = ['-y', 
          '-loop', '1',
          '-i', `${item.image}`,
          '-i', `${item.audio}`,
          '-framerate', '2',
          '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v', 'libx264',
          '-s', '1920x1080',
          '-r', '60',
          '-crf', '18',
          '-strict', 'experimental',
          '-tune', 'stillimage',
          '-c:a', 'copy',
          '-pix_fmt', 'yuv420p',
          `-progress`, `pipe:1`,
          '-shortest', videoName
        ]

        //./ffmpeg -i 1.mp4 -acodec libvo_aacenc -vcodec libx264 -s 1920x1080 -r 60 -strict experimental 1.mp4
        //ffmpeg -loop 1 -framerate 2 -i input.png -i audio.m4a -c:v libx264 -preset medium -tune stillimage -crf 18 -c:a copy -shortest -pix_fmt yuv420p output.mkv

        media[idx].video = videoName

        let fileName = videoName.replace(`${SCENE_FILES_DIR}/`, '')
        writeLog(fileName)
        spawnSync('echo', [`file ${fileName}`, '>>', `${SCENE_FILES_DIR}/files.txt`], { shell: true, stdio: 'inherit' })

        let ffmpeg = spawnSync(ffmpegPath, args);

        console.log(String(ffmpeg.stdout))
        console.log(String(ffmpeg.stderr))

      })
      )
    }
  })

    // I have no idea how this wokrs but it does https://decembersoft.com/posts/promises-in-serial-with-array-reduce/
    promises.reduce((promiseChain, currentTask) => {
        return promiseChain.then(chainResults =>
            currentTask.then(currentResult =>
                [ ...chainResults, currentResult ]
            )
        );
    }, Promise.resolve([])).then(arrayOfResults => {
        // Do something with all results
    });

  //await Promise.all(promises)
  writeLog("Scene files completed")

  let args = ['-y', '-safe', '0',
    '-f', 'concat',
    '-i', `${SCENE_FILES_DIR}/files.txt`,
    '-c', 'copy',
    '-movflags', '+faststart',
    `${SCENE_FILES_DIR}/final.mkv`]

  let ffmpeg = spawnSync(ffmpegPath, args);

  console.log(String(ffmpeg.stdout))
  console.log(String(ffmpeg.stderr))

} // end build

exports.publish = async function publish(params, annoucenment) {
  let [
    publishType,
    episode,
    scene,
  ] = params.split(/ /)

  switch (publishType) {
    case 'draft':
      return await exports.draft(episode, annoucenment)
    case 'live':
      return await exports.live(episode, annoucenment)
    case 'test':
      return await exports.test(episode, annoucenment)
  }     

  //console.log(publishType, episode, scene)
}

exports.draft = async function draft(episode, announcement) {
  console.log(APP_DIR)
  console.log(SCENE_FILES_DIR)
  let episodeURL = arcURL(episode)
  let linkURL = episodeURL.replace('raw.githubusercontent', 'github').replace('/master', '/blob/master')

  exports.build(episodeURL).then(nothing => {

    writeLog('uploading draft video')
      let output = spawnSync(`${APP_DIR}/venv/bin/python3`, [`${APP_DIR}/youtube-upload/bin/youtube-upload`,
        `--title=Automated Reality Channel Episode ${episode}`,
        `--description=Automated Reality Channel Episode ${episode} \n\n This video was automatically generated from this script file ${linkURL}`,
        `--tags=ARC Channel`,
        `--default-language=en`,
        `--default-audio-language=en`,
        `--client-secrets=${APP_DIR}/safe/client_secret.json`,
        `--embeddable=True`,
        `--privacy=unlisted`,
      `${SCENE_FILES_DIR}/final.mkv`
      ], { stdio: 'pipe', stderr: 'pipe'})

      console.log(output.status);

      let uploadOutput = output.stdout
      console.log(String(uploadOutput))

      announcement(Array.from(getURLs(String(uploadOutput)))[0])
  })
}

exports.live = async function live(episode, announcement) {
  console.log(APP_DIR)
  console.log(SCENE_FILES_DIR)
  let episodeURL = arcURL(episode)
  let linkURL = episodeURL.replace('raw.githubusercontent', 'github').replace('/master', '/blob/master')

  exports.build(episodeURL).then(nothing => {

    writeLog('uploading live video')
      let output = spawnSync(`${APP_DIR}/venv/bin/python3`, [`${APP_DIR}/youtube-upload/bin/youtube-upload`,
        `--title=Automated Reality Channel Episode ${episode}`,
        `--description=Automated Reality Channel Episode ${episode} \n\n This video was automatically generated from this script file ${linkURL}`,
        `--tags=ARC Channel`,
        `--default-language=en`,
        `--default-audio-language=en`,
        `--client-secrets=${APP_DIR}/safe/client_secret.json`,
        `--embeddable=True`,
        `--privacy=unlisted`,
      `${SCENE_FILES_DIR}/final.mkv`
      ], {stdio: 'pipe', stderr: 'pipe'})


      console.log(output.status);
      let uploadOutput = output.stdout.toString()

      announcement(Array.from(getURLs(uploadOutput))[0])

  })
}

exports.test = async function test(episode, annoucenment) {

  console.log(APP_DIR)
  console.log(SCENE_FILES_DIR)

  exports.build(arcURL(episode)).then(nothing => {

  let uploadOutput = `
    Using client secrets: /Users/fernando/git/me/mrpowerscripts/powerbot-discord/safe/client_secret.json
    Using credentials file: /Users/fernando/.youtube-upload-credentials.json
    Start upload: /Users/fernando/git/me/mrpowerscripts/powerbot-discord/workdir/final.mp4
    Video URL: https://www.youtube.com/watch?v=HNRMzGef9Cc
        `

    console.log(uploadOutput)
    try {
      annoucenment(Array.from(getURLs(uploadOutput))[0])
    } catch (e) { console.log(e) }
  })
}