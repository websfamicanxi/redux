/*------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';

export interface IMetricsService {
	readonly _serviceBrand: undefined;
	capture(event: string, params: Record<string, any>): void;
}

export const IMetricsService = createDecorator<IMetricsService>('metricsService');


// implemented by calling channel
export class MetricsService implements IMetricsService {

	readonly _serviceBrand: undefined;
	private readonly metricsService: IMetricsService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // (only usable on client side)
	) {
		this.metricsService = ProxyChannel.toService<IMetricsService>(mainProcessService.getChannel('void-channel-metrics'));
	}

	// call capture on the channel
	capture(...params: Parameters<IMetricsService['capture']>) {
		this.metricsService.capture(...params);
	}

}

registerSingleton(IMetricsService, MetricsService, InstantiationType.Eager);

