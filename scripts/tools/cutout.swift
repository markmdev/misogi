// Lifts the foreground subject out of an image with macOS Vision and writes a transparent PNG.
// Build: swiftc -O scripts/tools/cutout.swift -o scripts/tools/cutout
// Usage: cutout in.png out.png
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else { fputs("usage: cutout in out.png\n", stderr); exit(2) }
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
guard let ci = CIImage(contentsOf: input) else { fputs("cannot read \(input.path)\n", stderr); exit(1) }
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: ci)
do { try handler.perform([request]) } catch { fputs("vision failed: \(error)\n", stderr); exit(1) }
guard let result = request.results?.first else { fputs("no subject found\n", stderr); exit(3) }
do {
  let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
  let masked = CIImage(cvPixelBuffer: buffer)
  let ctx = CIContext()
  try ctx.writePNGRepresentation(of: masked, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
} catch { fputs("mask failed: \(error)\n", stderr); exit(1) }
