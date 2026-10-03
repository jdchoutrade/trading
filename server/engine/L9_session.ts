import { Candle, SessionInfo } from '../types.ts';

export function analyzeSession(candles: Candle[], currentTimeSec?: number): SessionInfo {
  const now = currentTimeSec ? new Date(currentTimeSec * 1000) : new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalUtcMinutes = utcHours * 60 + utcMinutes;

  // Local Phnom Penh time (UTC+7)
  const khmerHours = (utcHours + 7) % 24;
  const localTimeKm = `${String(khmerHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')} (ICT/Phnom Penh)`;

  // Check Rollover window: 21:45 - 23:15 UTC (1305 to 1395 minutes)
  const isRolloverBlocked = totalUtcMinutes >= 21 * 60 + 45 && totalUtcMinutes <= 23 * 60 + 15;

  let currentSession: SessionInfo['currentSession'] = 'OFF_HOURS';
  let isKillZone = false;
  let killZoneName: string | undefined;
  let closesInUtc = '07:00 UTC';
  let closesInMinutes = 0;

  if (isRolloverBlocked) {
    currentSession = 'ROLLOVER';
    closesInUtc = '23:15 UTC';
    closesInMinutes = 23 * 60 + 15 - totalUtcMinutes;
  } else if (totalUtcMinutes >= 12 * 60 && totalUtcMinutes < 16 * 60) {
    currentSession = 'OVERLAP';
    closesInUtc = '16:00 UTC';
    closesInMinutes = 16 * 60 - totalUtcMinutes;
    if (totalUtcMinutes >= 12 * 60 + 30 && totalUtcMinutes <= 15 * 60 + 30) {
      isKillZone = true;
      killZoneName = 'NY OPEN KILL ZONE';
    }
  } else if (totalUtcMinutes >= 7 * 60 && totalUtcMinutes < 16 * 60) {
    currentSession = 'LONDON';
    closesInUtc = '16:00 UTC';
    closesInMinutes = 16 * 60 - totalUtcMinutes;
    if (totalUtcMinutes >= 7 * 60 && totalUtcMinutes <= 10 * 60) {
      isKillZone = true;
      killZoneName = 'LONDON OPEN KILL ZONE';
    }
  } else if (totalUtcMinutes >= 16 * 60 && totalUtcMinutes < 21 * 60) {
    currentSession = 'NY';
    closesInUtc = '21:00 UTC';
    closesInMinutes = 21 * 60 - totalUtcMinutes;
  } else if (totalUtcMinutes >= 0 && totalUtcMinutes < 7 * 60) {
    currentSession = 'ASIA';
    closesInUtc = '07:00 UTC';
    closesInMinutes = 7 * 60 - totalUtcMinutes;
  } else {
    currentSession = 'OFF_HOURS';
    closesInUtc = '00:00 UTC';
    closesInMinutes = 24 * 60 - totalUtcMinutes;
  }

  // Extract Session Ranges from candles if available
  let asiaHigh = -Infinity;
  let asiaLow = Infinity;
  let londonHigh = -Infinity;
  let londonLow = Infinity;
  let pdh = -Infinity;
  let pdl = Infinity;
  let dailyOpen: number | undefined;

  const todayUtcDate = now.getUTCDate();
  for (const c of candles) {
    const cDate = new Date(c.time * 1000);
    const cUtcHours = cDate.getUTCHours();
    const isToday = cDate.getUTCDate() === todayUtcDate;

    // Daily open is first candle of today
    if (isToday && dailyOpen === undefined) {
      dailyOpen = c.open;
    }

    // Asia session: 00:00 - 07:00 UTC today
    if (isToday && cUtcHours >= 0 && cUtcHours < 7) {
      if (c.high > asiaHigh) asiaHigh = c.high;
      if (c.low < asiaLow) asiaLow = c.low;
    }

    // London session: 07:00 - 16:00 UTC today
    if (isToday && cUtcHours >= 7 && cUtcHours < 16) {
      if (c.high > londonHigh) londonHigh = c.high;
      if (c.low < londonLow) londonLow = c.low;
    }

    // Previous day: yesterday UTC
    if (cDate.getUTCDate() === (todayUtcDate === 1 ? 28 : todayUtcDate - 1)) {
      if (c.high > pdh) pdh = c.high;
      if (c.low < pdl) pdl = c.low;
    }
  }

  const defaultPrice = candles[candles.length - 1]?.close || 2650;
  return {
    currentSession,
    isKillZone,
    killZoneName,
    isRolloverBlocked,
    asiaRange:
      asiaHigh !== -Infinity ? { high: Number(asiaHigh.toFixed(2)), low: Number(asiaLow.toFixed(2)) } : undefined,
    londonRange:
      londonHigh !== -Infinity ? { high: Number(londonHigh.toFixed(2)), low: Number(londonLow.toFixed(2)) } : undefined,
    pdh: pdh !== -Infinity ? Number(pdh.toFixed(2)) : Number((defaultPrice + 12).toFixed(2)),
    pdl: pdl !== Infinity ? Number(pdl.toFixed(2)) : Number((defaultPrice - 14).toFixed(2)),
    dailyOpen: dailyOpen ? Number(dailyOpen.toFixed(2)) : defaultPrice,
    closesInUtc,
    closesInMinutes: Math.max(0, closesInMinutes),
    localTimeKm,
  };
}
