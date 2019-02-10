import { mount } from "enzyme";
import wait from "waait";
import toJSON from "enzyme-to-json";
import Router from "next/router";
import CreateItems, { CREATE_ITEM_MUTATION } from "../components/CreateItems";
import { MockedProvider } from "react-apollo/test-utils";
import { fakeItem } from "../lib/testUtils";

const dogImage = "https://dog.com/dog/jpg";

// mock the global
global.fetch = jest.fn().mockResolvedValue({
  json: () => ({
    secure_url: dogImage,
    eager: [{ secure_url: dogImage }]
  })
});

describe("<CreateItems />", () => {
  it("renders and matches snapshot", async () => {
    const wrapper = mount(
      <MockedProvider>
        <CreateItems />
      </MockedProvider>
    );
    const form = wrapper.find('[data-test="form"]');
    expect(toJSON(form)).toMatchSnapshot();
  });

  it("uploads a file when changed", async () => {
    const wrapper = mount(
      <MockedProvider>
        <CreateItems />
      </MockedProvider>
    );
    const input = wrapper.find('input[type="file"]');
    input.simulate("change", { target: { files: ["fakedog.jpg"] } });
    await wait();
    const component = wrapper.find("CreateItems").instance();
    expect(component.state.image).toEqual(dogImage);
    expect(component.state.largeImage).toEqual(dogImage);
    expect(global.fetch).toHaveBeenCalled();
    global.fetch.mockReset();
  });

  it("creates an item when the form is submitted", async () => {
    const item = fakeItem();
    const mocks = [
      {
        request: {
          query: CREATE_ITEM_MUTATION,
          variables: {
            title: item.title,
            description: item.description,
            image: "",
            largeImage: "",
            price: item.price
          }
        },
        result: {
          data: {
            createItem: {
              ...fakeItem(),
              id: 'abc123',
              __typename: "Item"
            }
          }
        }
      }
    ];

    const wrapper = mount(
      <MockedProvider mocks={mocks}>
        <CreateItems />
      </MockedProvider>
    );
    // simulate someone filling out the form
    wrapper
    .find("#title")
    .simulate("change", { target: { value: item.title, name: "title" } });
  wrapper
    .find("#price")
    .simulate("change", {
      target: { value: item.price, name: "price", type: "number" }
    });
  wrapper
    .find("#description")
    .simulate("change", {
      target: { value: item.description, name: "description" }
    });
    // mock the router
    Router.router = { push: jest.fn() };
    wrapper.find('form').simulate('submit');
    await wait(50);
    expect(Router.router.push).toHaveBeenCalled();
    expect(Router.router.push).toHaveBeenCalledWith({ pathname: '/item', query: { id: 'abc123'} });
  });

  it("handles state updating", async () => {
    const wrapper = mount(
      <MockedProvider>
        <CreateItems />
      </MockedProvider>
    );
    wrapper
      .find("#title")
      .simulate("change", { target: { value: "Testing", name: "title" } });
    wrapper
      .find("#price")
      .simulate("change", {
        target: { value: "50000", name: "price", type: "number" }
      });
    wrapper
      .find("#description")
      .simulate("change", {
        target: { value: "This is a really nice item", name: "description" }
      });

    expect(wrapper.find("CreateItems").instance().state).toMatchObject({
      title: "Testing",
      price: 50000,
      description: "This is a really nice item"
    });
  });
});
