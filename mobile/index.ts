// IMPORTANT: react-native-quick-crypto must be imported FIRST.
// It installs the WebCrypto globals (crypto.subtle, crypto.getRandomValues)
// that megajs (the Mega client) needs to decrypt folder listings and files.
import 'react-native-quick-crypto';

import 'expo-router/entry';
