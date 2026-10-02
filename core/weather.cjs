const { webGet } = require('./research-agent.cjs');
async function json(url, signal, get) {
  const response = await get(url, signal, 'application/json');
  return JSON.parse(response.html);
}
async function weather(location, days = 3, signal, get = webGet) {
  if (!location?.trim())
    return {
      success: false,
      verified: false,
      retryable: false,
      message:
        'Ask which city to use; do not guess the user’s location. It can be saved as weatherLocation in Settings.',
    };
  const geo = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geo.search = new URLSearchParams({
    name: location.trim(),
    count: '5',
    language: 'en',
    format: 'json',
  });
  const places = (await json(geo.href, signal, get)).results || [];
  if (!places.length)
    return {
      success: false,
      verified: false,
      retryable: false,
      message: 'No matching city. Ask for a city and country.',
    };
  const place = places[0];
  // If the top matches have the same city name in different regions, ask before reporting the wrong city.
  if (
    places.length > 1 &&
    !location.includes(',') &&
    places[1].name === place.name &&
    (places[1].population || 0) > (place.population || 0) / 2
  )
    return {
      success: false,
      verified: false,
      retryable: false,
      message: 'Location is ambiguous; ask which region.',
      choices: places.map((p) => [p.name, p.admin1, p.country].filter(Boolean).join(', ')),
    };
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: 'auto',
    forecast_days: String(days),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });
  const forecast = await json(url.href, signal, get);
  if (forecast.error || !forecast.current || !forecast.daily)
    throw Error('Weather source unavailable.');
  return {
    success: true,
    verified: true,
    source: {
      name: 'Open-Meteo',
      url: url.href,
      attribution: 'Weather data by Open-Meteo; locations by GeoNames.',
    },
    fetchedAt: new Date().toISOString(),
    location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    timezone: forecast.timezone,
    current: forecast.current,
    units: forecast.current_units,
    daily: forecast.daily,
    dailyUnits: forecast.daily_units,
    weatherCodes:
      '0 clear, 1–3 partly cloudy/overcast, 45/48 fog, 51–67 drizzle/rain, 71–77 snow, 80–82 rain showers, 85/86 snow showers, 95–99 thunderstorms',
    message:
      'Answer directly with conditions, temperature and relevant forecast. Cite Open-Meteo. Current values are weather model estimates at the returned time.',
  };
}
module.exports = { weather };
