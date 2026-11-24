export function stageSafeArea(width = 1920, height = 1080) {
  return { left: 96, top: 54, right: width - 96, bottom: height - 54 };
}
