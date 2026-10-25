/**
 * The specification vectors for the Wi-Fi network content type,
 * ../content/wifi.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 *
 * ZXing's example has a six-character WPA password, under the eight WPA
 * requires, so that vector is held to reading only and the conformance suite
 * expects validation to report the length.
 */

import type { WifiValue } from '../content/wifi.js';
import type { PayloadVector } from '../types.js';

const ZXING = 'https://github.com/zxing/zxing/wiki/Barcode-Contents';

const WPA3 = 'https://www.wi-fi.org/system/files/WPA3%20Specification%20v3.5.pdf';

const NO_EAP = { eapMethod: '', phase2: '', identity: '', anonymousIdentity: '' } as const;

export const wifiVectors: readonly PayloadVector<WifiValue>[] = [
	{
		text: 'WIFI:T:WPA;S:MyNet;P:MyPassword;;',
		value: { ssid: 'MyNet', security: 'wpa', password: 'MyPassword', hidden: false, ...NO_EAP },
		source: `WPA3 Specification v3.5, section 7.3, first example. ${WPA3}`,
	},
	{
		text: 'WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;',
		value: { ssid: 'MyNet', security: 'sae', password: 'MyPassword', hidden: false, ...NO_EAP },
		source: `WPA3 Specification v3.5, section 7.3: Transition Disable bit 0 set, WPA3 only. ${WPA3}`,
	},
	{
		text: 'WIFI: S:MyNet;;',
		value: { ssid: 'MyNet', security: 'nopass', password: '', hidden: false, ...NO_EAP },
		source: `WPA3 Specification v3.5, section 7.3: an open network, printed with its stray space. ${WPA3}`,
	},
	{
		text: 'WIFI:T:WPA;S:mynetwork;P:mypass;;',
		value: { ssid: 'mynetwork', security: 'wpa', password: 'mypass', hidden: false, ...NO_EAP },
		source: `ZXing wiki, Barcode Contents, Wi-Fi network config example. ${ZXING}`,
	},
	{
		text: 'WIFI:S:\\"foo\\;bar\\\\baz\\";;',
		value: { ssid: '"foo;bar\\baz"', security: 'nopass', password: '', hidden: false, ...NO_EAP },
		source: `ZXing wiki, Barcode Contents, Wi-Fi network config escaping example. ${ZXING}`,
	},
];
