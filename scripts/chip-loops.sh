#!/bin/zsh
# Makes the small copies of the dressed Muses' loops that home's challenge chips play, in public/art/motion/virgils/chip,
# for each loop that has none. Needs ffmpeg with libvpx and macOS's HEVC encoder; run it after adding a loop.
set -e
cd "${0:A:h}/../public/art/motion/virgils"
mkdir -p chip
for src in *.webm; do
  out=chip/${src%.webm}
  [[ -f $out.webm && -f $out.mov ]] && continue
  ffmpeg -v error -y -c:v libvpx-vp9 -i $src -vf "scale=112:112:flags=lanczos,format=yuva420p" -c:v libvpx-vp9 -b:v 0 -crf 44 -row-mt 1 -an $out.webm
  # Safari composites HEVC alpha as premultiplied.
  ffmpeg -v error -y -c:v libvpx-vp9 -i $src -vf "scale=112:112:flags=lanczos,format=rgba,premultiply=inplace=1,format=bgra" -c:v hevc_videotoolbox -q:v 40 -alpha_quality 0.5 -tag:v hvc1 -an $out.mov
done
