import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';

import { posthog } from './react/out/util/posthog.js'

interface IMetricsService {
	readonly _serviceBrand: undefined;
}

const IMetricsService = createDecorator<IMetricsService>('metricsService');
class MetricsService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super()
		posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', {
			api_host: 'https://us.i.posthog.com',
			person_profiles: 'identified_only' // we only track events from identified users. We identify them in Sidebar
		})
		const deviceId = this._telemetryService.devDeviceId
		console.debug('deviceId', deviceId)
		posthog.identify(deviceId)
	}


}

registerSingleton(IMetricsService, MetricsService, InstantiationType.Eager);
