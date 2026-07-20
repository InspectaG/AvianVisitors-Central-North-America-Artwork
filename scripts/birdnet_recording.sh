#!/usr/bin/env bash
# Performs the recording from the specified RTSP stream or soundcard
source /etc/birdnet/birdnet.conf

audio_filter_chain(){
  if [ "${AV_AUDIO_FILTER:-0}" != "1" ];then
    echo ""
    return
  fi
  local hp="${AV_FILTER_HIGHPASS:-300}"
  local lp="${AV_FILTER_LOWPASS:-10000}"
  if ! [[ "$hp" =~ ^[0-9]+$ ]];then hp=300;fi
  if ! [[ "$lp" =~ ^[0-9]+$ ]];then lp=10000;fi
  if [ "$hp" -lt 20 ];then hp=20;fi
  if [ "$hp" -gt 3000 ];then hp=3000;fi
  if [ "$lp" -lt 1000 ];then lp=1000;fi
  if [ "$lp" -gt 20000 ];then lp=20000;fi
  if [ "$lp" -le "$hp" ];then lp=$((hp + 1000));fi
  echo "highpass=f=${hp},lowpass=f=${lp}"
}

loop_ffmpeg(){
  local filter
  filter="$(audio_filter_chain)"
  local filter_args=()
  if [ -n "$filter" ];then
    filter_args=(-af "$filter")
  fi
  while true;do
    if ! ffmpeg -hide_banner -loglevel $LOGGING_LEVEL -nostdin ${1} -i ${2} -vn -map a:0 "${filter_args[@]}" -acodec pcm_s16le -ac 2 -ar 48000 -f segment -segment_format wav -segment_time ${RECORDING_LENGTH} -strftime 1 ${RECS_DIR}/StreamData/%F-birdnet-RTSP_${3}-%H:%M:%S.wav
    then
      sleep 1
    fi
  done
}

record_filtered_alsa(){
  local input="${1:-default}"
  local filter
  filter="$(audio_filter_chain)"
  local filter_args=()
  if [ -n "$filter" ];then
    filter_args=(-af "$filter")
  fi
  ffmpeg -hide_banner -loglevel "$LOGGING_LEVEL" -nostdin -f alsa -ac "${CHANNELS}" -i "$input" -vn -map a:0 "${filter_args[@]}" \
    -acodec pcm_s16le -ac "${CHANNELS}" -ar 48000 -f segment -segment_format wav -segment_time "${RECORDING_LENGTH}" \
    -strftime 1 "${RECS_DIR}/StreamData/%F-birdnet-%H:%M:%S.wav"
}

# Read the logging level from the configuration option
LOGGING_LEVEL="${LogLevel_BirdnetRecordingService}"
# If empty for some reason default to log level of error
[ -z $LOGGING_LEVEL ] && LOGGING_LEVEL='error'
# Additionally if we're at debug or info level then allow printing of script commands and variables
if [ "$LOGGING_LEVEL" == "info" ] || [ "$LOGGING_LEVEL" == "debug" ];then
  # Enable printing of commands/variables etc to terminal for debugging
  set -x
fi

[ -z $RECORDING_LENGTH ] && RECORDING_LENGTH=15
[ -d $RECS_DIR/StreamData ] || mkdir -p $RECS_DIR/StreamData

if [ -n "${RTSP_STREAM}" ];then
  # Explode the RTSP steam setting into an array so we can count the number we have
  RTSP_STREAMS_EXPLODED_ARRAY=(${RTSP_STREAM//,/ })
  FFMPEG_VERSION=$(ffmpeg -version | head -n 1 | cut -d ' ' -f 3 | cut -d '.' -f 1)

  STREAM_COUNT=1
  # Loop over the streams
  for i in "${RTSP_STREAMS_EXPLODED_ARRAY[@]}"
  do
    if [[ "$i" =~ ^rtsps?:// ]]; then
      [ $FFMPEG_VERSION -lt 5 ] && PARAM=-stimeout || PARAM=-timeout
      TIMEOUT_PARAM="$PARAM 10000000"
    elif [[ "$i" =~ ^[a-z]+:// ]]; then
      TIMEOUT_PARAM="-rw_timeout 10000000"
    else
      TIMEOUT_PARAM=""
    fi
    loop_ffmpeg "${TIMEOUT_PARAM}" "${i}" "${STREAM_COUNT}" &
    ((STREAM_COUNT += 1))
  done
  wait
else
  if ! pulseaudio --check;then pulseaudio --start;fi
  if pgrep arecord &> /dev/null ;then
    echo "Recording"
  else
    if [ -z ${REC_CARD} ];then
      if [ "${AV_AUDIO_FILTER:-0}" = "1" ];then
        record_filtered_alsa "default"
      else
        arecord -f S16_LE -c${CHANNELS} -r48000 -t wav --max-file-time ${RECORDING_LENGTH}\
	      	      	       --use-strftime ${RECS_DIR}/StreamData/%F-birdnet-%H:%M:%S.wav
      fi
    else
      if [ "${AV_AUDIO_FILTER:-0}" = "1" ];then
        record_filtered_alsa "${REC_CARD}"
      else
        arecord -f S16_LE -c${CHANNELS} -r48000 -t wav --max-file-time ${RECORDING_LENGTH}\
          -D "${REC_CARD}" --use-strftime ${RECS_DIR}/StreamData/%F-birdnet-%H:%M:%S.wav
      fi
    fi
  fi
fi
