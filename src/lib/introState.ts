let played = false

/** 同一页面会话只播一次；刷新页面会重新开始 */
export function hasPlayedIntro(): boolean {
  return played
}

export function markIntroPlayed(): void {
  played = true
}
