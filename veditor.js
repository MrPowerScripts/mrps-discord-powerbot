import rp from 'request-promise'
import yaml from 'js-yaml'
import fs from 'fs'
import glob from 'glob'
import speak from 'espeak'
import { writeLog, SCENE_FILES_DIR, APP_DIR, arcURL } from './utils'
import { path as ffmpegPath} from '@ffmpeg-installer/ffmpeg';
import { spawnSync } from 'child_process';

// maybe need this? qt-faststart
exports.build = async function build(scriptURL) {
    writeLog("veditor- building script")

    // use some hard codded commands for various builds
    switch(scriptURL) {
      case "test":
        scriptURL = arcURL('test')
        break
    }
    // make the workdir if it doesn't exist
    if (!fs.existsSync(SCENE_FILES_DIR)){
      fs.mkdirSync(SCENE_FILES_DIR);
    }
    // cleanup workdir first for each scene
    writeLog('Cleanup workdir')
    glob(`${SCENE_FILES_DIR}/*`, {}, (err, files)=>{
      files.forEach(file => fs.unlinkSync(file))
    })

    // create a random string to use as a file prefix
    let filePrefix = Math.random().toString(36).substr(2, 5) 

    writeLog('downloading script')
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
          promises.push(rp(scene.visual_media, {encoding: null})
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
      if(item.hasOwnProperty('image')) {
        promises.push(new Promise((resolve, reject) => {

        let videoName = `${item.image.replace(/\.[^/.]+$/, "")}-stitch.mp4`

        let args = ['-y', '-loop', '1', 
        '-i', `${item.image}`, 
        '-i', `${item.audio}`, 
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v', 'libx264', 
        '-s', '1920x1080',
        '-r', '60',
        '-strict', 'experimental',
        '-tune', 'stillimage', 
        '-c:a', 'aac', 
        '-b:a', '192k', 
        '-pix_fmt', 'yuv420p',
        `-progress`, `pipe:1`,
        '-shortest', videoName
        ]

        //./ffmpeg -i 1.mp4 -acodec libvo_aacenc -vcodec libx264 -s 1920x1080 -r 60 -strict experimental 1.mp4

        media[idx].video = videoName

        let fileName = videoName.replace(`${SCENE_FILES_DIR}/`, '')
        writeLog(fileName)
        spawnSync('echo', [`file ${fileName}`, '>>', `${SCENE_FILES_DIR}/files.txt`], {shell: true, stdio: 'inherit'})

        let ffmpeg = spawnSync(ffmpegPath, args);
          
        writeLog(String(ffmpeg.stdout))
        writeLog(String(ffmpeg.stderr))

        args = ['-y', '-safe', '0', 
                '-f', 'concat', 
                '-i', `${SCENE_FILES_DIR}/files.txt`, 
                '-c', 'copy',
                `-progress`, `pipe:1`,
                `${SCENE_FILES_DIR}/final.mp4`]

         ffmpeg = spawnSync(ffmpegPath, args);

          writeLog(String(ffmpeg.stdout))
          writeLog(String(ffmpeg.stderr))

          })
        )
      }
    })
} // end build

exports.publish = async function publish(params) {
  let [
    publishType,
    episode,
    scene,
  ] = params.split(/ /)

  switch (publishType) {
    case 'draft':
      exports.draft(episode, scene)
      break
  }

  //console.log(publishType, episode, scene)
}

exports.draft = async function draft(episode, scene=null) {
  
  if (scene) {
    let script = await rp(arcURL(episode)).then(async resp => yaml.safeLoad(resp))
    writeLog(script)
    let sceneScript = script.scenes[scene - 1]
  
    console.log(sceneScript)
  } else {

    console.log(APP_DIR)
    console.log(SCENE_FILES_DIR)

    exports.build(arcURL(episode)).then(nothing => {
      let output = spawnSync(`${APP_DIR}/venv/bin/python3`, [`${APP_DIR}/youtube-upload/bin/youtube-upload`,
        `--title="Automated Reality"`,
        `--description=Automated Reality Channel`,
        `--tags=ARC Channel`,
        `--default-language=en`,
        `--default-audio-language=en`,
        `--client-secrets=${APP_DIR}/safe/client_secret.json`,
        `--embeddable=True`,
        `--privacy=unlisted`,
        `${SCENE_FILES_DIR}/final.mp4`
        ], {})

      console.log(String(output.stdout))
      console.log(String(output.stderr))
    })
  
  }


}