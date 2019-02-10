import React, { Component } from "react";
import { Mutation } from "react-apollo";
import gql from "graphql-tag";
import ErrorMessage from "./ErrorMessage";
import Form from "./styles/Form";

const REQUEST_RESET_MUTATION = gql`
  mutation REQUEST_RESET_MUTATION($email: String!) {
    requestReset(email: $email) {
      message
    }
  }
`;

class RequestReset extends Component {
  state = {
    email: ""
  };

  saveToState = e => {
    this.setState({ [e.target.name]: e.target.value });
  };

  render() {
    return (
      <Mutation
        mutation={REQUEST_RESET_MUTATION}
        variables={this.state}
      >
        {(requestReset, { error, loading, called }) => (
          <Form
            data-test="form"
            method="post"
            onSubmit={async e => {
              e.preventDefault();
              await requestReset();
              this.setState = {
                email: ""
              };
            }}
          >
            <fieldset disabled={loading} aria-busy={loading}>
              <h2>Request a Password Reset</h2>
              <ErrorMessage error={error} />
              {!error && !loading && called && <p>Success! Check your email for a reset link</p>}
              <label htmlFor="email">
                Email
                <input
                  type="email"
                  name="email"
                  placeholder="Email"
                  value={this.state.email}
                  onChange={this.saveToState}
                />
              </label>

              <button type="submit">Reset Password!</button>
            </fieldset>
          </Form>
        )}
      </Mutation>
    );
  }
}

export default RequestReset;
export { REQUEST_RESET_MUTATION };
