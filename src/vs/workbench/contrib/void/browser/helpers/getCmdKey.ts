/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../../base/common/platform.js';

// import { OperatingSystem, OS } from '../../../../base/common/platform.js';
// OS === OperatingSystem.Macintosh
export function getCmdKey(): string {
	if (isMacintosh) {
		return '⌘';
	} else {
		return 'Ctrl';
	}
}




