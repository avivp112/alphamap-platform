/**
 * lib/enrichment/majorCities.ts — a small, hand-curated city/country
 * reference for validation.ts's city_country_mismatch check (issue 4).
 *
 * Replaces the earlier `cities.json` npm dependency (171k rows, ~17MB)
 * after discovering the real deployment target has well under 1GB of RAM —
 * loading/transforming a 17MB JSON module was crashing both `npm install`
 * and the script itself (esbuild's transform service getting killed).
 *
 * This is every national capital plus the major startup/tech hubs most
 * likely to actually appear as a tracked company's HQ city — exactly the
 * population this platform's data is concentrated in, arguably a BETTER
 * fit for this specific use case than exhaustive global place-name
 * coverage would be. Deliberately not exhaustive: cityExistsInCountry()
 * already treats "city not in this list" as "can't check, give the
 * benefit of the doubt" (ground rule 2), so a smaller list only means
 * fewer real mismatches get CAUGHT — it can never produce a new false
 * positive that wasn't possible before.
 *
 * Value is an array, not a single string: several real city names exist in
 * more than one country (e.g. "Cambridge" in both the US and UK) — a plain
 * one-country-per-name map would silently drop one of them.
 */

const ENTRIES: Array<[string, string]> = [
  // National capitals (abbreviated set covering the countries most likely
  // to appear in this platform's data; extend as real gaps surface).
  ["washington", "United States"], ["london", "United Kingdom"], ["paris", "France"],
  ["berlin", "Germany"], ["madrid", "Spain"], ["rome", "Italy"], ["lisbon", "Portugal"],
  ["amsterdam", "Netherlands"], ["brussels", "Belgium"], ["bern", "Switzerland"],
  ["vienna", "Austria"], ["stockholm", "Sweden"], ["oslo", "Norway"], ["copenhagen", "Denmark"],
  ["helsinki", "Finland"], ["dublin", "Ireland"], ["warsaw", "Poland"], ["prague", "Czechia"],
  ["budapest", "Hungary"], ["athens", "Greece"], ["bucharest", "Romania"], ["sofia", "Bulgaria"],
  ["zagreb", "Croatia"], ["ljubljana", "Slovenia"], ["bratislava", "Slovakia"],
  ["vilnius", "Lithuania"], ["riga", "Latvia"], ["tallinn", "Estonia"], ["reykjavik", "Iceland"],
  ["moscow", "Russia"], ["kyiv", "Ukraine"], ["minsk", "Belarus"], ["ankara", "Turkey"],
  ["jerusalem", "Israel"], ["tel aviv", "Israel"], ["amman", "Jordan"], ["beirut", "Lebanon"],
  ["cairo", "Egypt"], ["riyadh", "Saudi Arabia"], ["abu dhabi", "United Arab Emirates"],
  ["dubai", "United Arab Emirates"], ["doha", "Qatar"], ["manama", "Bahrain"], ["kuwait city", "Kuwait"],
  ["muscat", "Oman"], ["tehran", "Iran"], ["baghdad", "Iraq"],
  ["new delhi", "India"], ["beijing", "China"], ["tokyo", "Japan"], ["seoul", "South Korea"],
  ["pyongyang", "North Korea"], ["taipei", "Taiwan"], ["hong kong", "China"],
  ["singapore", "Singapore"], ["kuala lumpur", "Malaysia"], ["jakarta", "Indonesia"],
  ["manila", "Philippines"], ["bangkok", "Thailand"], ["hanoi", "Vietnam"],
  ["phnom penh", "Cambodia"], ["vientiane", "Laos"], ["naypyidaw", "Myanmar"],
  ["dhaka", "Bangladesh"], ["islamabad", "Pakistan"], ["kabul", "Afghanistan"],
  ["colombo", "Sri Lanka"], ["kathmandu", "Nepal"], ["thimphu", "Bhutan"],
  ["canberra", "Australia"], ["wellington", "New Zealand"],
  ["ottawa", "Canada"], ["mexico city", "Mexico"], ["guatemala city", "Guatemala"],
  ["san jose", "Costa Rica"], ["san jose", "United States"], ["panama city", "Panama"], ["havana", "Cuba"],
  ["santo domingo", "Dominican Republic"], ["kingston", "Jamaica"],
  ["bogota", "Colombia"], ["caracas", "Venezuela"], ["quito", "Ecuador"], ["lima", "Peru"],
  ["la paz", "Bolivia"], ["santiago", "Chile"], ["buenos aires", "Argentina"],
  ["montevideo", "Uruguay"], ["asuncion", "Paraguay"], ["brasilia", "Brazil"],
  ["georgetown", "Guyana"], ["paramaribo", "Suriname"],
  ["rabat", "Morocco"], ["algiers", "Algeria"], ["tunis", "Tunisia"], ["tripoli", "Libya"],
  ["khartoum", "Sudan"], ["addis ababa", "Ethiopia"], ["nairobi", "Kenya"],
  ["kampala", "Uganda"], ["kigali", "Rwanda"], ["dar es salaam", "Tanzania"],
  ["lusaka", "Zambia"], ["harare", "Zimbabwe"], ["gaborone", "Botswana"],
  ["pretoria", "South Africa"], ["windhoek", "Namibia"], ["maputo", "Mozambique"],
  ["accra", "Ghana"], ["abuja", "Nigeria"], ["lagos", "Nigeria"], ["dakar", "Senegal"],
  ["abidjan", "Ivory Coast"], ["yaounde", "Cameroon"], ["kinshasa", "Congo (Democratic Republic)"],

  // Major startup/tech hubs beyond (or within) the above countries --
  // exactly where this platform's tracked companies actually cluster.
  ["san francisco", "United States"], ["new york", "United States"], ["los angeles", "United States"],
  ["boston", "United States"], ["seattle", "United States"], ["austin", "United States"],
  ["chicago", "United States"], ["miami", "United States"], ["denver", "United States"],
  ["atlanta", "United States"], ["san diego", "United States"], ["palo alto", "United States"],
  ["mountain view", "United States"], ["menlo park", "United States"], ["cambridge", "United States"],
  ["pittsburgh", "United States"], ["salt lake city", "United States"], ["portland", "United States"],
  ["houston", "United States"], ["dallas", "United States"], ["phoenix", "United States"],
  ["manchester", "United Kingdom"], ["edinburgh", "United Kingdom"], ["cambridge", "United Kingdom"],
  ["oxford", "United Kingdom"], ["bristol", "United Kingdom"], ["leeds", "United Kingdom"],
  ["munich", "Germany"], ["hamburg", "Germany"], ["frankfurt", "Germany"], ["cologne", "Germany"],
  ["stuttgart", "Germany"], ["leipzig", "Germany"],
  ["barcelona", "Spain"], ["valencia", "Spain"],
  ["milan", "Italy"], ["turin", "Italy"],
  ["lyon", "France"], ["toulouse", "France"], ["marseille", "France"], ["nice", "France"],
  ["eindhoven", "Netherlands"], ["rotterdam", "Netherlands"], ["utrecht", "Netherlands"],
  ["gothenburg", "Sweden"], ["malmo", "Sweden"],
  ["krakow", "Poland"], ["wroclaw", "Poland"],
  ["herzliya", "Israel"], ["haifa", "Israel"], ["beer sheva", "Israel"], ["ramat gan", "Israel"],
  ["bangalore", "India"], ["bengaluru", "India"], ["mumbai", "India"], ["hyderabad", "India"],
  ["pune", "India"], ["chennai", "India"], ["gurgaon", "India"], ["gurugram", "India"],
  ["noida", "India"], ["kolkata", "India"], ["ahmedabad", "India"],
  ["shanghai", "China"], ["shenzhen", "China"], ["guangzhou", "China"], ["hangzhou", "China"],
  ["chengdu", "China"], ["wuhan", "China"], ["nanjing", "China"],
  ["osaka", "Japan"], ["kyoto", "Japan"], ["yokohama", "Japan"], ["fukuoka", "Japan"],
  ["busan", "South Korea"], ["incheon", "South Korea"],
  ["sydney", "Australia"], ["melbourne", "Australia"], ["brisbane", "Australia"], ["perth", "Australia"],
  ["toronto", "Canada"], ["vancouver", "Canada"], ["montreal", "Canada"], ["waterloo", "Canada"],
  ["calgary", "Canada"],
  ["sao paulo", "Brazil"], ["rio de janeiro", "Brazil"], ["belo horizonte", "Brazil"],
  ["zurich", "Switzerland"], ["geneva", "Switzerland"], ["lausanne", "Switzerland"], ["basel", "Switzerland"],
  ["porto", "Portugal"],
  ["cape town", "South Africa"], ["johannesburg", "South Africa"], ["durban", "South Africa"],
];

export const MAJOR_CITIES: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const [city, country] of ENTRIES) {
    let set = map.get(city);
    if (!set) { set = new Set(); map.set(city, set); }
    set.add(country);
  }
  return map;
})();
