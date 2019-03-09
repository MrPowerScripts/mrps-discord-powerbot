import rp from 'request-promise'
import yaml from 'js-yaml'
import fs from 'fs'
import glob from 'glob'
import speak from 'espeak'
import { writeLog, SCENE_FILES_DIR } from './utils'
import { path as ffmpegPath} from '@ffmpeg-installer/ffmpeg';
import { spawnSync } from 'child_process';

// maybe need this? qt-faststart
export default async function build(scriptURL) {
    writeLog("veditor- building script")

    // use some hard codded commands for various builds
    switch(scriptURL) {
      case "test":
        scriptURL = "https://raw.githubusercontent.com/MrPowerScripts/automated-reality-channel/master/sample-script.yml"
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
        '-shortest', videoName
        ]

        //./ffmpeg -i 1.mp4 -acodec libvo_aacenc -vcodec libx264 -s 1920x1080 -r 60 -strict experimental 1.mp4

        media[idx].video = videoName

        let fileName = videoName.replace(`${SCENE_FILES_DIR}/`, '')
        console.log(fileName)
        spawnSync('echo', [`file ${fileName}`, '>>', `${SCENE_FILES_DIR}/files.txt`], {shell: true, stdio: 'inherit'})

        const ffmpeg = spawnSync(ffmpegPath, args);
          
        args = ['-y', '-safe', '0', 
                '-f', 'concat', 
                '-i', `${SCENE_FILES_DIR}/files.txt`, 
                '-c', 'copy', 
                `${SCENE_FILES_DIR}/final.mp4`]

         let resp = spawnSync(ffmpegPath, args);

          console.log(String(resp.stdout))
          console.log(String(resp.stderr))

          
          })
        )
      }
    })
} // end build