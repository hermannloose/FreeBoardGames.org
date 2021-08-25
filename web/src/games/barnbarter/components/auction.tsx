import * as React from 'react';
import { IAuction } from '../definitions';
import { BCard } from './cards';

interface InnerWrapper {
  auction: IAuction;
}

export class BAuction extends React.Component<InnerWrapper, {}> {
  render() {
    return (
      <div>
        <BCard cards={this.props.auction.card === null ? [] : [this.props.auction.card]}></BCard>
        {this.props.auction.counter == 0 ? ' ' : this.props.auction.counter == 1 ? '⏰' : '⏰⏰'}
      </div>
    );
  }
}
