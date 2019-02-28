import rp from 'request-promise'
import yaml from 'js-yaml'
import fs from 'fs'
import glob from 'glob'
import speak from 'espeak'
import videoshow from 'videoshow'
import videoStitch from 'video-stitch'
let videoConcat = videoStitch.concat;
import { writeLog, SCENE_FILES_DIR, videoOptions } from './utils'

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
    glob(`${__dirname}/${SCENE_FILES_DIR}/*`, {}, (err, files)=>{
      files.forEach(file => fs.unlinkSync(file))
    })

    // create a random string to use as a file prefix
    let filePrefix = Math.random().toString(36).substr(2, 5) 

    writeLog('downloading script')
    let script = await rp(scriptURL).then(async resp => yaml.safeLoad(resp)) // loading the script yaml file

    let promises = []
    let media = []

    script.scenes.forEach(async (scene, idx) => {
      let sceneMedia = {}
      let pre = `${filePrefix}-${idx}` // prefix all files to make them unique per scene
      sceneMedia.prefix = pre


      writeLog('downloading scene audio')
      let audio = `./${SCENE_FILES_DIR}/${pre}-audio.wav`
      if (scene.audio_media == 'tts') {
        // auto generate tts audio
        speak.speak(scene.audio_script, (err, wave) => {
          fs.writeFileSync(audio, wave.buffer)
        })
      } else { }// do stuff to grab remote audio and process
      sceneMedia.audio = audio


      let visual = `./${SCENE_FILES_DIR}/${pre}-visual.${scene.visual_type}`
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
          videoshow([item.image], videoOptions)
            .audio(item.audio)
            .save(`./${SCENE_FILES_DIR}/${item.prefix}-stitch.mp4`)
            .on('start', (command) => {
              console.log('ffmpeg process started:', command)
            })
            .on('error', (err, stdout, stderr) => {
              console.error('Error:', err)
              console.error('ffmpeg stderr:', stderr)
              reject(err);
            })
            .on('end', (output) => {
              console.log('Video created in:', output)
              media[idx].video = output
              resolve(output);
            })
          })
        )
      }
    })

    // This doesn't work :((
    // await Promise.all(promises)
    // console.log('we waited againd')

    //   writeLog('Building final video')
    //   glob(`${__dirname}/${SCENE_FILES_DIR}/*stitch*`, {}, async (err, files)=>{
    //     writeLog('showing the stich files')
    //     console.log(files)

    //     let fileList = files.map(file => ({fileName: file}))
        
    //     console.log(fileList)
    //     videoConcat({
    //       silent: true, // optional. if set to false, gives detailed output on console
    //       overwrite: true // optional. by default, if file already exists, ffmpeg will ask for overwriting in console and that pause the process. if set to true, it will force overwriting. if set to false it will prevent overwriting.
    //     })
    //     .clips(fileList)
    //     .output(`${__dirname}/${SCENE_FILES_DIR}/complete.mp4`) //optional absolute file name for output file
    //     .concat()
    //     .then((outputFileName) => {
          
    //     })
    //   })
} // end build