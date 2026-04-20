import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';

export class NoopAdapter extends BaseAdapter {
  readonly platform = Platform.UNKNOWN;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    void input;
    yield* [] as IUnifiedMessage[];
  }
}
