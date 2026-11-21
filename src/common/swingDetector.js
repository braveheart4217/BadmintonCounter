const GRAVITY = 9.80665

const SENSITIVITY_PRESETS = {
  low: {
    label: '低',
    startThreshold: 22.0,
    endThreshold: 10.0,
    minPeak: 26.0
  },
  medium: {
    label: '中',
    startThreshold: 15.0,
    endThreshold: 8.0,
    minPeak: 18.0
  },
  high: {
    label: '高',
    startThreshold: 10.0,
    endThreshold: 5.5,
    minPeak: 13.0
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

class SwingDetector {
  /**
   * 羽毛球挥拍检测与速度估算器
   * 使用“自动单位检测 + 自适应重力跟踪 + 三状态机 + 短窗口梯形积分”
   */
  constructor(options = {}) {
    this.calibrationFactor = 2.2
    this.sensitivity = 'medium'
    this.maxSwingMs = options.maxSwingMs !== undefined ? options.maxSwingMs : 260
    this.minSwingMs = options.minSwingMs !== undefined ? options.minSwingMs : 40
    this.cooldownMs = options.cooldownMs !== undefined ? options.cooldownMs : 500
    this.maxSpeedKmh = options.maxSpeedKmh !== undefined ? options.maxSpeedKmh : 450
    this.unitCalibrationSamples =
      options.unitCalibrationSamples !== undefined ? options.unitCalibrationSamples : 10

    this.updateConfig(options)
    this.reset()
  }

  /**
   * 更新标定系数或灵敏度档位
   */
  updateConfig(partial = {}) {
    if (typeof partial.calibrationFactor === 'number' && Number.isFinite(partial.calibrationFactor)) {
      this.calibrationFactor = clamp(Math.round(partial.calibrationFactor * 10) / 10, 1.0, 4.0)
    }
    if (partial.sensitivity && SENSITIVITY_PRESETS[partial.sensitivity]) {
      this.sensitivity = partial.sensitivity
    }
  }

  /**
   * 重置状态机和单位检测状态（每次重新开始监测时建议调用）
   */
  reset() {
    this.state = 'IDLE'
    this.gravityEst = GRAVITY
    this.unitDetected = false
    this.unitScale = 1.0
    this.unitSampleCount = 0
    this.unitMagSum = 0

    this.lastTimestamp = null
    this.swingStartTime = 0
    this.peakDyn = 0
    this.peakMag = 0
    this.velocityIntegral = 0
    this.prevDyn = 0
    this.sampleCount = 0
    this.cooldownUntil = 0
  }

  getState() {
    return this.state
  }

  /**
   * 仅重置当前挥拍累积数据并回到待机
   */
  _resetSwingTracking() {
    this.state = 'IDLE'
    this.swingStartTime = 0
    this.peakDyn = 0
    this.peakMag = 0
    this.velocityIntegral = 0
    this.prevDyn = 0
    this.sampleCount = 0
  }

  /**
   * 处理单帧三轴加速度样本
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [timestampMs]
   * @returns {null | {speedKmh: number, peakG: number, durationMs: number, wristSpeedMs: number, timestamp: number}}
   */
  processSample(x, y, z, timestampMs) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null
    }

    const ts =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs) ? timestampMs : Date.now()

    let dtSec = 0.02
    if (this.lastTimestamp !== null) {
      const deltaMs = ts - this.lastTimestamp
      if (deltaMs > 0 && deltaMs <= 100) {
        dtSec = deltaMs / 1000
      }
    }
    this.lastTimestamp = ts

    const rawMag = Math.sqrt(x * x + y * y + z * z)

    // 前 N 帧自动探测传感器返回单位是 g (~1.0) 还是 m/s² (~9.8)
    if (!this.unitDetected) {
      this.unitMagSum += rawMag
      this.unitSampleCount += 1
      if (this.unitSampleCount >= this.unitCalibrationSamples) {
        const meanMag = this.unitMagSum / this.unitSampleCount
        this.unitScale = meanMag < 2.5 ? GRAVITY : 1.0
        this.unitDetected = true
        this.gravityEst = GRAVITY
        if (this.unitScale !== 1.0) {
          this._resetSwingTracking()
        }
      }
    }

    const mag = rawMag * this.unitScale
    const dyn = Math.max(0, mag - this.gravityEst)
    const preset = SENSITIVITY_PRESETS[this.sensitivity] || SENSITIVITY_PRESETS.medium

    if (this.state === 'COOLDOWN') {
      if (ts >= this.cooldownUntil) {
        this.state = 'IDLE'
      } else {
        return null
      }
    }

    if (this.state === 'IDLE') {
      if (dyn > preset.startThreshold) {
        this.state = 'SWINGING'
        this.swingStartTime = ts
        this.peakDyn = dyn
        this.peakMag = mag
        this.velocityIntegral = 0
        this.prevDyn = dyn
        this.sampleCount = 1
        return null
      }

      // 静止或轻缓移动时慢速跟踪重力基准，挥拍期间冻结
      if (this.unitDetected && Math.abs(mag - this.gravityEst) < 3.0) {
        this.gravityEst = 0.95 * this.gravityEst + 0.05 * mag
      }
      return null
    }

    if (this.state === 'SWINGING') {
      this.velocityIntegral += 0.5 * (this.prevDyn + dyn) * dtSec
      if (dyn > this.peakDyn) {
        this.peakDyn = dyn
      }
      if (mag > this.peakMag) {
        this.peakMag = mag
      }
      this.prevDyn = dyn
      this.sampleCount += 1

      const elapsedMs = ts - this.swingStartTime
      if (dyn < preset.endThreshold || elapsedMs >= this.maxSwingMs) {
        const durationMs = elapsedMs
        const peakDyn = this.peakDyn
        const peakMag = this.peakMag
        const wristSpeedMs = this.velocityIntegral

        if (durationMs >= this.minSwingMs && peakDyn >= preset.minPeak) {
          const rawKmh = wristSpeedMs * 3.6 * this.calibrationFactor
          const clampedKmh = clamp(rawKmh, 1, this.maxSpeedKmh)
          const speedKmh = Math.round(clampedKmh * 10) / 10
          const peakG = Math.round((peakMag / GRAVITY) * 10) / 10

          this._resetSwingTracking()
          this.state = 'COOLDOWN'
          this.cooldownUntil = ts + this.cooldownMs

          return {
            speedKmh,
            peakG,
            durationMs,
            wristSpeedMs: Math.round(wristSpeedMs * 100) / 100,
            timestamp: ts
          }
        }

        // 短暂抖动或峰值不足，丢弃并回待机
        this._resetSwingTracking()
        return null
      }
    }

    return null
  }
}

module.exports = {
  GRAVITY,
  SENSITIVITY_PRESETS,
  SwingDetector
}
